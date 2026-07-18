using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    public sealed class IndustrialFactoryV2ValidationIssue
    {
        public IndustrialFactoryV2ValidationIssue(string code, string path, string message)
        {
            Code = DungeonV2Contract.RequireId(code, nameof(code));
            Path = string.IsNullOrWhiteSpace(path) ? "/" : path;
            Message = message ?? string.Empty;
        }

        public string Code { get; }
        public string Path { get; }
        public string Message { get; }

        public override string ToString() => Code + " at " + Path + ": " + Message;
    }

    public sealed class IndustrialFactoryV2ValidationResult
    {
        public IndustrialFactoryV2ValidationResult(IEnumerable<IndustrialFactoryV2ValidationIssue> errors)
        {
            Errors = DungeonV2Contract.CopyOrdered(errors, nameof(errors));
        }

        public bool Accepted => Errors.Count == 0;
        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> Errors { get; }
    }

    /// <summary>
    /// Profile-specific hard-correctness checks which complement the aggregate
    /// constructor's ownership and reference validation.
    /// </summary>
    public sealed class IndustrialFactoryV2Validator : IIndustrialFactoryV2CandidateValidator
    {
        public const double EncounterFootprintClearanceRadius = 1.5d;
        public const double HazardRouteGroundingTolerance = 0.3d;
        public const double HazardRouteContactTolerance = 0.05d;

        private static readonly string[] RequiredWaterConfigurations =
        {
            IndustrialFactoryV2Ruleset.FreightSumpFilled,
            IndustrialFactoryV2Ruleset.GantrySumpFilled,
            IndustrialFactoryV2Ruleset.StoredInReservoir
        };

        public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan)
        {
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            if (plan == null)
            {
                Add(errors, "PLAN_REQUIRED", "/", "A DungeonPlanV2 is required.");
                return new IndustrialFactoryV2ValidationResult(errors);
            }

            if (!string.Equals(plan.RulesetVersion, IndustrialFactoryV2Ruleset.RulesetVersion, StringComparison.Ordinal)
                || !string.Equals(plan.ProfileId, IndustrialFactoryV2Ruleset.ProfileId, StringComparison.Ordinal))
            {
                Add(errors, "PROFILE_MISMATCH", "/profileId", "The plan is not industrial-factory-v2.");
            }

            if (plan.VoidPolicy != DungeonVoidPolicyV2.Prohibited)
            {
                Add(errors, "VOID_POLICY_INVALID", "/voidPolicy", "industrial-factory-v2 prohibits void fall destinations.");
            }

            if (plan.MacroRoles.Count != 7 || plan.Regions.Count < 12 || plan.Regions.Count > 18)
            {
                Add(errors, "SPATIAL_BUDGET_INVALID", "/regions", "The profile requires seven macro roles and 12-18 playable regions.");
            }

            foreach (IndustrialFactoryV2ValidationIssue issue in
                DungeonCertifiedModulePlacementValidatorV2.Validate(plan))
            {
                errors.Add(issue);
            }

            DungeonBiomeDistrictPlanV2 factory = FindDistrict(plan, DungeonBiomeDistrictKindV2.Factory);
            DungeonBiomeDistrictPlanV2 waterworks = FindDistrict(plan, DungeonBiomeDistrictKindV2.Waterworks);
            DungeonBiomeDistrictPlanV2 hazard = FindHazardDistrict(plan);
            if (factory == null || waterworks == null || hazard == null || plan.Districts.Count != 3)
            {
                Add(errors, "DISTRICT_SET_INVALID", "/districts", "Factory, Waterworks, and one Hazard Undercroft are required.");
                return new IndustrialFactoryV2ValidationResult(errors);
            }

            ValidateDistrictSpan(plan, waterworks, 3, 3, "WATERWORKS_SPAN_INVALID", errors);
            ValidateDistrictSpan(plan, hazard, 2, 2, "HAZARD_SPAN_INVALID", errors);
            ValidateWaterworks(plan, waterworks, errors);
            ValidateDiscoveries(plan, waterworks, hazard, errors);
            ValidateDamageFreeHazardExploration(plan, hazard, errors);
            ValidateEncounterFootprintClearance(plan, errors);
            foreach (IndustrialFactoryV2ValidationIssue issue in
                new IndustrialFactoryV2StaticProfileValidator().Validate(plan))
            {
                errors.Add(issue);
            }
            ValidateRoutes(plan, errors);
            ValidateFallCoverage(plan, errors);
            ValidateProgression(plan, errors);
            return new IndustrialFactoryV2ValidationResult(errors);
        }

        private static void ValidateEncounterFootprintClearance(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            var protectedAnchorIds = new HashSet<string>(
                plan.Anchors
                    .Where(anchor => IsEncounterProtectedAnchorKind(anchor.Kind))
                    .Select(anchor => anchor.Id),
                StringComparer.Ordinal);
            var edges = plan.TraversalEdges.ToDictionary(value => value.Id, StringComparer.Ordinal);
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes.Where(value =>
                         value.Role == DungeonRouteRoleV2.Recovery
                         || value.Role == DungeonRouteRoleV2.Return
                         || value.Role == DungeonRouteRoleV2.Shortcut))
            foreach (string edgeId in route.OrderedTraversalEdgeIds)
            {
                if (edges.TryGetValue(edgeId, out DungeonTraversalEdgePlanV2 edge))
                {
                    protectedAnchorIds.Add(edge.FromAnchorId);
                    protectedAnchorIds.Add(edge.ToAnchorId);
                }
            }

            double minimumSquared = EncounterFootprintClearanceRadius
                * EncounterFootprintClearanceRadius;
            foreach (DungeonAnchorPlanV2 encounter in plan.Anchors.Where(value =>
                         value.Kind == DungeonAnchorKindV2.Encounter))
            foreach (DungeonAnchorPlanV2 protectedAnchor in plan.Anchors.Where(value =>
                         protectedAnchorIds.Contains(value.Id)))
            {
                double deltaX = encounter.Position.X - protectedAnchor.Position.X;
                double deltaY = encounter.Position.Y - protectedAnchor.Position.Y;
                double deltaZ = encounter.Position.Z - protectedAnchor.Position.Z;
                double distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
                if (distanceSquared + 1e-12d >= minimumSquared)
                {
                    continue;
                }

                Add(
                    errors,
                    "ENCOUNTER_FOOTPRINT_BLOCKS_CRITICAL_ANCHOR",
                    "/anchors/" + encounter.Id,
                    "Encounter footprint is only " + Math.Sqrt(distanceSquared).ToString("0.###")
                        + " units from protected anchor '" + protectedAnchor.Id
                        + "'. Safe pads, consoles, exits, and return-route anchors require at least "
                        + EncounterFootprintClearanceRadius.ToString("0.###") + " units of clearance.");
            }
        }

        private static bool IsEncounterProtectedAnchorKind(DungeonAnchorKindV2 kind)
        {
            return kind == DungeonAnchorKindV2.Safe
                || kind == DungeonAnchorKindV2.Console
                || kind == DungeonAnchorKindV2.Entry
                || kind == DungeonAnchorKindV2.Exit
                || kind == DungeonAnchorKindV2.ShortcutActivation
                || kind == DungeonAnchorKindV2.Extraction;
        }

        private static void ValidateWaterworks(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 waterworks,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            if (plan.FluidNetworks.Count != 1)
            {
                Add(errors, "WATER_NETWORK_COUNT", "/fluidNetworks", "Exactly one Waterworks network is required.");
                return;
            }

            DungeonFluidNetworkPlanV2 network = plan.FluidNetworks[0];
            if (!string.Equals(network.Id, IndustrialFactoryV2Ruleset.WaterNetworkId, StringComparison.Ordinal))
            {
                Add(errors, "WATER_NETWORK_ID", "/fluidNetworks/0/id", "The Waterworks network uses the wrong stable ID.");
            }

            if (!string.Equals(
                network.InitialConfigurationId,
                IndustrialFactoryV2Ruleset.FreightSumpFilled,
                StringComparison.Ordinal))
            {
                Add(errors, "WATER_INITIAL_CONFIGURATION", "/fluidNetworks/0/initialConfigurationId", "Waterworks must start FreightSumpFilled.");
            }

            var configurations = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonFluidConfigurationPlanV2 configuration in network.StableConfigurations)
            {
                configurations.Add(configuration.Id);
            }

            if (configurations.Count != RequiredWaterConfigurations.Length)
            {
                Add(errors, "WATER_CONFIGURATION_COUNT", "/fluidNetworks/0/stableConfigurations", "Exactly three stable configurations are required.");
            }

            foreach (string required in RequiredWaterConfigurations)
            {
                if (!configurations.Contains(required))
                {
                    Add(errors, "WATER_CONFIGURATION_MISSING", "/fluidNetworks/0/stableConfigurations", "Missing " + required + ".");
                }
            }

            foreach (string regionId in waterworks.RegionIds)
            {
                if (!Contains(network.RegionIds, regionId))
                {
                    Add(errors, "WATER_REGION_NOT_NETWORKED", "/districts/" + waterworks.Id, "Waterworks region is outside the fluid network: " + regionId);
                }
            }

            if (waterworks.EntranceTransitionIds.Count < 2)
            {
                Add(errors, "WATER_ENTRANCE_COUNT", "/districts/" + waterworks.Id,
                    "Waterworks requires entrances from at least two macro roles.");
            }

            DungeonEnvironmentControllerPlanV2 routingController = plan.EnvironmentControllers
                .FirstOrDefault(value => string.Equals(
                    value.Id,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    StringComparison.Ordinal));
            if (routingController == null)
            {
                Add(errors, "WATER_ROUTING_CONTROLLER_MISSING", "/environmentControllers",
                    "Waterworks requires the stable water-routing controller.");
                return;
            }

            ValidateWaterRoutingReversibility(plan, routingController, errors);
            ValidateStateDependentWaterDiscoveries(plan, waterworks, routingController, errors);
        }

        private static void ValidateWaterRoutingReversibility(
            DungeonPlanV2 plan,
            DungeonEnvironmentControllerPlanV2 routingController,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            foreach (DungeonControllerTransitionPlanV2 transition in routingController.Transitions)
            {
                if (!transition.CommitsAtomically || Math.Abs(transition.PresentationSeconds - 2.5d) > 1e-9d)
                {
                    Add(errors, "WATER_TRANSFER_CONTRACT_INVALID",
                        "/environmentControllers/" + routingController.Id + "/transitions/" + transition.Id,
                        "Water transfers must commit atomically after exactly 2.5 seconds.");
                }
            }

            foreach (string sourceState in routingController.StableStateIds)
            {
                var reachable = new HashSet<string>(StringComparer.Ordinal) { sourceState };
                var queue = new Queue<string>();
                queue.Enqueue(sourceState);
                while (queue.Count > 0)
                {
                    string current = queue.Dequeue();
                    DungeonPredicateStateV2 predicateState = BuildPermissiveWaterState(plan, current);
                    foreach (DungeonControllerTransitionPlanV2 transition in routingController.Transitions)
                    {
                        if (!string.Equals(transition.FromStateId, current, StringComparison.Ordinal)
                            || !DungeonPredicateEvaluatorV2.Evaluate(transition.ActivationPredicate, predicateState)
                            || !reachable.Add(transition.ToStateId))
                        {
                            continue;
                        }

                        queue.Enqueue(transition.ToStateId);
                    }
                }

                if (reachable.Count != routingController.StableStateIds.Count)
                {
                    Add(errors, "WATER_ROUTING_NOT_REVERSIBLE",
                        "/environmentControllers/" + routingController.Id,
                        "Every committed water configuration must reach every other configuration after valve unlock; "
                            + sourceState + " reaches only " + string.Join(",", reachable) + ".");
                }
            }
        }

        private static void ValidateStateDependentWaterDiscoveries(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 waterworks,
            DungeonEnvironmentControllerPlanV2 routingController,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            bool floodedDiscovery = false;
            bool drainedDiscovery = false;
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                if (!string.Equals(discovery.DistrictId, waterworks.Id, StringComparison.Ordinal))
                {
                    continue;
                }

                string requiredState = null;
                foreach (string stateId in routingController.StableStateIds)
                {
                    if (RequiresExclusiveControllerState(
                        discovery.AccessPredicate,
                        routingController.Id,
                        stateId))
                    {
                        requiredState = stateId;
                        break;
                    }
                }

                if (requiredState == null)
                {
                    continue;
                }

                DungeonAnchorPlanV2 anchor = plan.Anchors.First(value =>
                    string.Equals(value.Id, discovery.LocationAnchorId, StringComparison.Ordinal));
                if (!CanReachRegionInWaterState(plan, anchor.RegionId, requiredState)
                    || !DungeonPredicateEvaluatorV2.Evaluate(
                        discovery.AccessPredicate,
                        BuildPermissiveWaterState(plan, requiredState)))
                {
                    Add(errors, "WATER_STATE_DISCOVERY_UNREACHABLE", "/discoveries/" + discovery.Id,
                        "The state-dependent discovery cannot be recovered in " + requiredState + ".");
                    continue;
                }

                floodedDiscovery |= string.Equals(
                        requiredState,
                        IndustrialFactoryV2Ruleset.FreightSumpFilled,
                        StringComparison.Ordinal)
                    || string.Equals(
                        requiredState,
                        IndustrialFactoryV2Ruleset.GantrySumpFilled,
                        StringComparison.Ordinal);
                drainedDiscovery |= string.Equals(
                    requiredState,
                    IndustrialFactoryV2Ruleset.StoredInReservoir,
                    StringComparison.Ordinal);
            }

            if (!floodedDiscovery)
            {
                Add(errors, "WATER_FLOODED_DISCOVERY_MISSING", "/discoveries",
                    "Waterworks requires a recoverable discovery exclusive to a filled configuration.");
            }

            if (!drainedDiscovery)
            {
                Add(errors, "WATER_DRAINED_DISCOVERY_MISSING", "/discoveries",
                    "Waterworks requires a recoverable discovery exclusive to StoredInReservoir.");
            }
        }

        private static bool RequiresExclusiveControllerState(
            DungeonAccessPredicateV2 predicate,
            string controllerId,
            string stateId)
        {
            if (predicate.Clauses.Count == 0)
            {
                return false;
            }

            foreach (DungeonPredicateClauseV2 clause in predicate.Clauses)
            {
                bool clauseRequiresState = clause.Conditions.Any(condition =>
                    condition.Kind == DungeonPredicateConditionKindV2.ControllerState
                    && condition.Operator == DungeonPredicateOperatorV2.Equals
                    && string.Equals(condition.SubjectId, controllerId, StringComparison.Ordinal)
                    && string.Equals(condition.ExpectedValue, stateId, StringComparison.Ordinal));
                if (!clauseRequiresState)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool CanReachRegionInWaterState(
            DungeonPlanV2 plan,
            string targetRegionId,
            string waterState)
        {
            DungeonPredicateStateV2 predicateState = BuildPermissiveWaterState(plan, waterState);
            var reversibleEdges = new HashSet<string>(
                plan.Routes
                    .Where(value => value.ReverseTraversalPolicy == DungeonReverseTraversalPolicyV2.Bidirectional)
                    .SelectMany(value => value.OrderedTraversalEdgeIds),
                StringComparer.Ordinal);
            var reached = new HashSet<string>(StringComparer.Ordinal) { plan.EntranceRegionId };
            var queue = new Queue<string>();
            queue.Enqueue(plan.EntranceRegionId);
            while (queue.Count > 0)
            {
                string current = queue.Dequeue();
                if (string.Equals(current, targetRegionId, StringComparison.Ordinal))
                {
                    return true;
                }

                foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
                {
                    if (!DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, predicateState))
                    {
                        continue;
                    }

                    string next = null;
                    if (string.Equals(edge.FromRegionId, current, StringComparison.Ordinal))
                    {
                        next = edge.ToRegionId;
                    }
                    else if (reversibleEdges.Contains(edge.Id)
                        && string.Equals(edge.ToRegionId, current, StringComparison.Ordinal))
                    {
                        next = edge.FromRegionId;
                    }

                    if (next != null && reached.Add(next))
                    {
                        queue.Enqueue(next);
                    }
                }
            }

            return false;
        }

        private static DungeonPredicateStateV2 BuildPermissiveWaterState(
            DungeonPlanV2 plan,
            string waterState)
        {
            var controllerStates = new List<DungeonControllerStateFactV2>();
            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            {
                string state = controller.InitialStateId;
                if (string.Equals(controller.Id, IndustrialFactoryV2Ruleset.WaterRoutingControllerId, StringComparison.Ordinal))
                {
                    state = waterState;
                }
                else if (string.Equals(controller.Id, IndustrialFactoryV2Ruleset.ValveUnlockControllerId, StringComparison.Ordinal)
                    && controller.StableStateIds.Contains("Unlocked"))
                {
                    state = "Unlocked";
                }
                else if (controller.StableStateIds.Contains("Grounded"))
                {
                    state = "Grounded";
                }

                controllerStates.Add(new DungeonControllerStateFactV2(controller.Id, state));
            }

            return new DungeonPredicateStateV2(
                new[] { IndustrialFactoryV2Ruleset.CredentialKeyRewardId },
                controllerStates,
                plan.Shortcuts.Select(value => value.Id),
                plan.Discoveries.Select(value => value.Id),
                Array.Empty<string>(),
                Array.Empty<string>());
        }

        private static void ValidateDiscoveries(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 waterworks,
            DungeonBiomeDistrictPlanV2 hazard,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            int shortcutDiscoveries = 0;
            int smallDiscoveries = 0;
            var landmarkDistricts = new HashSet<string>(StringComparer.Ordinal);
            bool waterMajor = false;
            bool hazardMajor = false;
            bool credentialKey = false;

            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                if (discovery.Kind == DungeonDiscoveryKindV2.Shortcut)
                {
                    shortcutDiscoveries += 1;
                }

                if (discovery.Kind == DungeonDiscoveryKindV2.Lore
                    || (discovery.Kind == DungeonDiscoveryKindV2.Salvage && discovery.CompletionSignificance <= 1))
                {
                    smallDiscoveries += 1;
                }

                if (discovery.Kind == DungeonDiscoveryKindV2.Landmark)
                {
                    landmarkDistricts.Add(discovery.DistrictId);
                }

                waterMajor |= string.Equals(discovery.DistrictId, waterworks.Id, StringComparison.Ordinal)
                    && string.Equals(discovery.DurableRewardId, IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId, StringComparison.Ordinal)
                    && discovery.CompletionSignificance >= 3;
                credentialKey |= string.Equals(discovery.DurableRewardId, IndustrialFactoryV2Ruleset.CredentialKeyRewardId, StringComparison.Ordinal);

                string expectedHazardReward = hazard.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                    ? IndustrialFactoryV2Ruleset.HeatResistChipRewardId
                    : IndustrialFactoryV2Ruleset.AncientBatteryPackRewardId;
                hazardMajor |= string.Equals(discovery.DistrictId, hazard.Id, StringComparison.Ordinal)
                    && string.Equals(discovery.DurableRewardId, expectedHazardReward, StringComparison.Ordinal)
                    && discovery.CompletionSignificance >= 3;
            }

            if (!waterMajor)
            {
                Add(errors, "WATER_MAJOR_REWARD_MISSING", "/discoveries", "Waterworks needs the curated coolingFinArray recovery.");
            }

            if (!hazardMajor)
            {
                Add(errors, "HAZARD_MAJOR_REWARD_MISSING", "/discoveries", "The selected Undercroft needs its curated major reward.");
            }

            if (!credentialKey)
            {
                Add(errors, "CREDENTIAL_KEY_MISSING", "/discoveries", "The credential key discovery is required before the final gate.");
            }

            if (smallDiscoveries < 2)
            {
                Add(errors, "SMALL_DISCOVERY_BUDGET", "/discoveries", "At least two small lore or curated-salvage discoveries are required.");
            }

            if (shortcutDiscoveries < 1 || plan.Shortcuts.Count < 1)
            {
                Add(errors, "SHORTCUT_DISCOVERY_MISSING", "/shortcuts", "A planned and discoverable shortcut is required.");
            }

            foreach (DungeonBiomeDistrictPlanV2 district in plan.Districts)
            {
                if (!landmarkDistricts.Contains(district.Id))
                {
                    Add(errors, "DISTRICT_LANDMARK_MISSING", "/districts/" + district.Id, "Each district requires a landmark discovery.");
                }
            }
        }

        private static void ValidateDamageFreeHazardExploration(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 hazard,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            string expectedReward = hazard.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                ? IndustrialFactoryV2Ruleset.HeatResistChipRewardId
                : IndustrialFactoryV2Ruleset.AncientBatteryPackRewardId;
            DungeonDiscoveryPlanV2 majorReward = plan.Discoveries.FirstOrDefault(value =>
                string.Equals(value.DistrictId, hazard.Id, StringComparison.Ordinal)
                && string.Equals(value.DurableRewardId, expectedReward, StringComparison.Ordinal)
                && value.CompletionSignificance >= 3);
            if (majorReward == null)
            {
                return;
            }

            DungeonAnchorPlanV2 rewardAnchor = plan.Anchors.First(value =>
                string.Equals(value.Id, majorReward.LocationAnchorId, StringComparison.Ordinal));
            DungeonExplorationRoutePlanV2 recoveryRoute = plan.Routes.FirstOrDefault(value =>
                value.Role == DungeonRouteRoleV2.Recovery
                && value.DiscoveryIds.Contains(majorReward.Id));
            if (recoveryRoute == null)
            {
                Add(errors, "HAZARD_REWARD_RECOVERY_ROUTE_MISSING", "/discoveries/" + majorReward.Id,
                    "The Undercroft major reward must belong to the permanent recovery route.");
                return;
            }

            if (!IsCertifiedHazardFreePoint(plan, rewardAnchor.Position, rewardAnchor.RegionId))
            {
                Add(errors, "HAZARD_REWARD_REQUIRES_DAMAGE", "/discoveries/" + majorReward.Id,
                    "The major reward lacks capsule-safe footing outside all hazard tiles.");
            }

            var routePointsByRegion = new Dictionary<string, List<DungeonPoint3>>(StringComparer.Ordinal);
            foreach (string edgeId in recoveryRoute.OrderedTraversalEdgeIds)
            {
                DungeonTraversalEdgePlanV2 edge = plan.TraversalEdges.First(value =>
                    string.Equals(value.Id, edgeId, StringComparison.Ordinal));
                AddHazardRouteAnchor(plan, hazard, routePointsByRegion, edge.FromAnchorId);
                AddHazardRouteAnchor(plan, hazard, routePointsByRegion, edge.ToAnchorId);
            }

            if (!routePointsByRegion.TryGetValue(rewardAnchor.RegionId, out List<DungeonPoint3> rewardRegionPoints))
            {
                rewardRegionPoints = new List<DungeonPoint3>();
                routePointsByRegion.Add(rewardAnchor.RegionId, rewardRegionPoints);
            }
            rewardRegionPoints.Insert(Math.Min(1, rewardRegionPoints.Count), rewardAnchor.Position);

            foreach (KeyValuePair<string, List<DungeonPoint3>> pair in routePointsByRegion)
            {
                for (int index = 0; index < pair.Value.Count; index += 1)
                {
                    if (!IsCertifiedHazardFreePoint(plan, pair.Value[index], pair.Key))
                    {
                        Add(errors, "HAZARD_RECOVERY_ANCHOR_UNSAFE", "/routes/" + recoveryRoute.Id,
                            "Recovery anchor in " + pair.Key + " overlaps a hazard or lacks safe footing.");
                        break;
                    }

                    if (index > 0 && !IsCertifiedHazardFreeSegment(
                        plan,
                        pair.Value[index - 1],
                        pair.Value[index],
                        pair.Key))
                    {
                        Add(errors, "HAZARD_DAMAGE_FREE_ROUTE_MISSING", "/routes/" + recoveryRoute.Id,
                            "The certified route through " + pair.Key + " crosses unavoidable hazard damage.");
                        break;
                    }
                }
            }
        }

        private static void AddHazardRouteAnchor(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 hazard,
            IDictionary<string, List<DungeonPoint3>> routePointsByRegion,
            string anchorId)
        {
            DungeonAnchorPlanV2 anchor = plan.Anchors.First(value =>
                string.Equals(value.Id, anchorId, StringComparison.Ordinal));
            if (!hazard.RegionIds.Contains(anchor.RegionId))
            {
                return;
            }

            if (!routePointsByRegion.TryGetValue(anchor.RegionId, out List<DungeonPoint3> points))
            {
                points = new List<DungeonPoint3>();
                routePointsByRegion.Add(anchor.RegionId, points);
            }

            if (points.Count == 0 || !SameHorizontalPoint(points[points.Count - 1], anchor.Position))
            {
                points.Add(anchor.Position);
            }
        }

        private static bool IsCertifiedHazardFreeSegment(
            DungeonPlanV2 plan,
            DungeonPoint3 from,
            DungeonPoint3 to,
            string regionId)
        {
            double distance = Math.Sqrt(
                (to.X - from.X) * (to.X - from.X)
                + (to.Z - from.Z) * (to.Z - from.Z));
            int samples = Math.Max(1, (int)Math.Ceiling(distance / 0.2d));
            for (int index = 0; index <= samples; index += 1)
            {
                double t = index / (double)samples;
                var point = new DungeonPoint3(
                    from.X + (to.X - from.X) * t,
                    from.Y + (to.Y - from.Y) * t,
                    from.Z + (to.Z - from.Z) * t);
                if (!IsCertifiedHazardFreePoint(plan, point, regionId))
                {
                    return false;
                }
            }

            return true;
        }

        private static bool IsCertifiedHazardFreePoint(
            DungeonPlanV2 plan,
            DungeonPoint3 point,
            string regionId)
        {
            bool hasFooting = plan.Surfaces.Any(surface =>
                string.Equals(surface.RegionId, regionId, StringComparison.Ordinal)
                && surface.IsWalkable
                && surface.Kind != DungeonSurfaceKindV2.Hazard
                && Math.Abs(point.Y - surface.Volume.MaximumY) <= HazardRouteGroundingTolerance
                && DungeonProgressionSolverV2.PointInsideConvex(
                    point.X,
                    point.Z,
                    surface.Volume.HorizontalVertices,
                    TraversalProfilesV2.Dry.CapsuleRadius));
            if (!hasFooting)
            {
                return false;
            }

            return !plan.Surfaces.Any(surface =>
                string.Equals(surface.RegionId, regionId, StringComparison.Ordinal)
                && surface.Kind == DungeonSurfaceKindV2.Hazard
                && surface.Volume.MaximumY
                    >= point.Y - HazardRouteContactTolerance
                && surface.Volume.MinimumY
                    <= point.Y + TraversalProfilesV2.Dry.CapsuleHeight
                        + HazardRouteContactTolerance
                && DungeonProgressionSolverV2.PointInsideConvex(
                    point.X,
                    point.Z,
                    surface.Volume.HorizontalVertices,
                    -TraversalProfilesV2.Dry.CapsuleRadius));
        }

        private static bool SameHorizontalPoint(DungeonPoint3 a, DungeonPoint3 b)
        {
            return Math.Abs(a.X - b.X) <= 1e-9d && Math.Abs(a.Z - b.Z) <= 1e-9d;
        }

        private static void ValidateRoutes(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            bool critical = false;
            bool recovery = false;
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes)
            {
                critical |= route.Role == DungeonRouteRoleV2.Critical;
                recovery |= route.Role == DungeonRouteRoleV2.Recovery;
                if (route.Role != DungeonRouteRoleV2.Critical
                    && route.EstimatedTraversalSeconds > 45d
                    && route.DiscoveryIds.Count == 0
                    && route.Role != DungeonRouteRoleV2.Shortcut)
                {
                    Add(errors, "EMPTY_LONG_BRANCH", "/routes/" + route.Id, "Optional routes over 45 seconds must pay off.");
                }
            }

            if (!critical)
            {
                Add(errors, "CRITICAL_ROUTE_MISSING", "/routes", "A critical Factory route is required.");
            }

            if (!recovery)
            {
                Add(errors, "RECOVERY_ROUTE_MISSING", "/routes", "A Hazard Undercroft recovery route is required.");
            }

            ValidateProtectedRouteExitAuthorizations(plan, errors);
        }

        private static void ValidateProtectedRouteExitAuthorizations(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            var protectedFarSides = new HashSet<string>(
                plan.TraversalEdges
                    .Where(value => value.IsProtectedProgressionBoundary)
                    .Select(value => value.ToRegionId),
                StringComparer.Ordinal);
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes)
            foreach (DungeonAuthorizedExitPlanV2 exit in route.AuthorizedExits)
            {
                if (!protectedFarSides.Contains(exit.RejoinRegionId))
                {
                    continue;
                }

                bool requiresCredential = exit.EarliestAuthorizationPredicate.Clauses.Count > 0
                    && exit.EarliestAuthorizationPredicate.Clauses.All(clause => clause.Conditions.Any(condition =>
                        condition.Kind == DungeonPredicateConditionKindV2.RequiredItem
                        && condition.Operator == DungeonPredicateOperatorV2.IsPresent
                        && string.Equals(
                            condition.SubjectId,
                            IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                            StringComparison.Ordinal)));
                if (!requiresCredential)
                {
                    Add(errors, "ROUTE_EXIT_AUTHORIZATION_BYPASS",
                        "/routes/" + route.Id + "/authorizedExits/" + exit.Id,
                        "A route may not rejoin the protected Machine Core far side before credential authorization.");
                }
            }
        }

        private static void ValidateFallCoverage(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            if (plan.FallExposures.Count < 2 || plan.FallCatchments.Count < 2)
            {
                Add(errors, "FALL_COVERAGE_MISSING", "/fallExposures", "Waterworks and Undercroft fall coverage records are required.");
            }

            foreach (DungeonFallExposurePlanV2 exposure in plan.FallExposures)
            {
                if (exposure.RequiredCatchmentIds.Count == 0)
                {
                    Add(errors, "UNCOVERED_EXPOSURE", "/fallExposures/" + exposure.Id, "Every exposure requires a catchment chain.");
                }
            }

            foreach (IndustrialFactoryV2ValidationIssue issue in new DungeonFallCoverageValidatorV2().Validate(plan))
            {
                errors.Add(issue);
            }
        }

        private static void ValidateProgression(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            DungeonProgressionSolveResultV2 solve = new DungeonProgressionSolverV2().Solve(plan);
            if (!solve.ExtractionReachable)
            {
                Add(errors, "EXTRACTION_UNREACHABLE", "/solver", "No legal stable-state path reaches extraction.");
            }

            if (solve.DeadEndStateKeys.Count > 0)
            {
                Add(
                    errors,
                    "PROGRESSION_DEAD_END",
                    "/solver",
                    solve.DeadEndStateKeys.Count + " reachable stable states cannot reach extraction; first: "
                        + solve.DeadEndStateKeys[0]);
            }

            foreach (string violation in solve.ProtectedBoundaryViolations)
            {
                Add(errors, "PROTECTED_BOUNDARY_BYPASS", "/solver/protectedBoundaries", violation);
            }
        }

        private static void ValidateDistrictSpan(
            DungeonPlanV2 plan,
            DungeonBiomeDistrictPlanV2 district,
            int minimumRegions,
            int minimumMacros,
            string code,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            var macros = new HashSet<string>(StringComparer.Ordinal);
            foreach (string regionId in district.RegionIds)
            {
                DungeonRegionPlanV2 region = FindRegion(plan, regionId);
                if (region != null)
                {
                    macros.Add(region.MacroRoleId);
                }
            }

            if (district.RegionIds.Count < minimumRegions || macros.Count < minimumMacros)
            {
                Add(errors, code, "/districts/" + district.Id, "District does not meet its region/macro span.");
            }
        }

        private static DungeonBiomeDistrictPlanV2 FindDistrict(DungeonPlanV2 plan, DungeonBiomeDistrictKindV2 kind)
        {
            foreach (DungeonBiomeDistrictPlanV2 district in plan.Districts)
            {
                if (district.Kind == kind)
                {
                    return district;
                }
            }

            return null;
        }

        private static DungeonBiomeDistrictPlanV2 FindHazardDistrict(DungeonPlanV2 plan)
        {
            foreach (DungeonBiomeDistrictPlanV2 district in plan.Districts)
            {
                if (district.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                    || district.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                {
                    return district;
                }
            }

            return null;
        }

        private static DungeonRegionPlanV2 FindRegion(DungeonPlanV2 plan, string id)
        {
            foreach (DungeonRegionPlanV2 region in plan.Regions)
            {
                if (string.Equals(region.Id, id, StringComparison.Ordinal))
                {
                    return region;
                }
            }

            return null;
        }

        private static bool Contains(IReadOnlyList<string> values, string target)
        {
            foreach (string value in values)
            {
                if (string.Equals(value, target, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static void Add(
            ICollection<IndustrialFactoryV2ValidationIssue> errors,
            string code,
            string path,
            string message)
        {
            errors.Add(new IndustrialFactoryV2ValidationIssue(code, path, message));
        }
    }
}
