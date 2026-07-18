using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    public sealed class DungeonProgressionSolveResultV2
    {
        internal DungeonProgressionSolveResultV2(
            int reachableStateCount,
            int extractionRegionStateCount,
            int extractionReadyStateCount,
            bool extractionReachable,
            IEnumerable<string> deadEndStateKeys,
            IEnumerable<string> protectedBoundaryViolations)
        {
            ReachableStateCount = reachableStateCount;
            ExtractionRegionStateCount = extractionRegionStateCount;
            ExtractionReadyStateCount = extractionReadyStateCount;
            ExtractionReachable = extractionReachable;
            DeadEndStateKeys = Array.AsReadOnly((deadEndStateKeys ?? Array.Empty<string>()).ToArray());
            ProtectedBoundaryViolations = Array.AsReadOnly(
                (protectedBoundaryViolations ?? Array.Empty<string>()).ToArray());
        }

        public int ReachableStateCount { get; }
        public int ExtractionRegionStateCount { get; }
        public int ExtractionReadyStateCount { get; }
        public bool ExtractionReachable { get; }
        public IReadOnlyList<string> DeadEndStateKeys { get; }
        public IReadOnlyList<string> ProtectedBoundaryViolations { get; }
    }

    /// <summary>
    /// Finite, engine-independent progression solver. It enumerates only stable
    /// route-affecting facts: region, required items, committed controller
    /// states, activated shortcuts, and discovery facts referenced by access
    /// predicates. Timed hazard phases and water-transfer presentation never
    /// enter the state key.
    /// </summary>
    public sealed class DungeonProgressionSolverV2
    {
        private const int MaximumStates = 8192;

        public DungeonProgressionSolveResultV2 Solve(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));

            var controllerConsoleRegions = plan.Anchors
                .Where(value => value.Kind == DungeonAnchorKindV2.Console
                    && !string.IsNullOrWhiteSpace(value.ProfileId))
                .GroupBy(value => value.ProfileId, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => new HashSet<string>(group.Select(value => value.RegionId), StringComparer.Ordinal),
                    StringComparer.Ordinal);
            HashSet<string> routeDiscoveryFacts = CollectReferencedDiscoveryFacts(plan);
            HashSet<string> reversibleEdges = new HashSet<string>(
                plan.Routes
                    .Where(value => value.ReverseTraversalPolicy == DungeonReverseTraversalPolicyV2.Bidirectional)
                    .SelectMany(value => value.OrderedTraversalEdgeIds),
                StringComparer.Ordinal);
            Dictionary<string, DungeonAnchorPlanV2> anchors = plan.Anchors.ToDictionary(
                value => value.Id,
                StringComparer.Ordinal);

            SolverState initial = SolverState.CreateInitial(plan);
            var states = new Dictionary<string, SolverState>(StringComparer.Ordinal);
            var adjacency = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            var queue = new Queue<SolverState>();
            AddState(initial, states, adjacency, queue);

            while (queue.Count > 0)
            {
                SolverState current = queue.Dequeue();
                string currentKey = current.Key;
                foreach (SolverState next in Expand(
                    plan,
                    current,
                    controllerConsoleRegions,
                    routeDiscoveryFacts,
                    reversibleEdges,
                    anchors))
                {
                    string nextKey = next.Key;
                    adjacency[currentKey].Add(nextKey);
                    if (states.ContainsKey(nextKey)) continue;
                    if (states.Count >= MaximumStates)
                    {
                        throw new InvalidOperationException(
                            "Dungeon V2 progression state limit exceeded; a route fact is not finitely bounded.");
                    }

                    AddState(next, states, adjacency, queue);
                }
            }

            KeyValuePair<string, SolverState>[] extractionRegionStates = states
                .Where(pair => string.Equals(
                        pair.Value.RegionId,
                        plan.ExtractionRegionId,
                        StringComparison.Ordinal))
                .ToArray();
            var goalKeys = new HashSet<string>(
                extractionRegionStates
                    .Where(pair => pair.Value.ProgressionFacts.Contains(
                        IndustrialFactoryV2Ruleset.ExtractionReadyFactId))
                    .Select(pair => pair.Key),
                StringComparer.Ordinal);
            HashSet<string> canReachGoal = ReverseReachable(goalKeys, adjacency);
            string[] deadEnds = states.Keys
                .Where(key => !canReachGoal.Contains(key))
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            string[] boundaryViolations = ValidateProtectedBoundaries(plan, states.Values)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            return new DungeonProgressionSolveResultV2(
                states.Count,
                extractionRegionStates.Length,
                goalKeys.Count,
                goalKeys.Count > 0,
                deadEnds,
                boundaryViolations);
        }

        private static IEnumerable<SolverState> Expand(
            DungeonPlanV2 plan,
            SolverState current,
            IReadOnlyDictionary<string, HashSet<string>> controllerConsoleRegions,
            ISet<string> routeDiscoveryFacts,
            ISet<string> reversibleEdges,
            IReadOnlyDictionary<string, DungeonAnchorPlanV2> anchors)
        {
            DungeonPredicateStateV2 predicateState = current.ToPredicateState();

            // The Machine Core is an objective sequence, not an extraction
            // goal merely because the player can stand in its region. The
            // guardian first enables the Refractor; a separate interaction
            // then secures it and makes extraction ready.
            if (string.Equals(current.RegionId, plan.ExtractionRegionId, StringComparison.Ordinal))
            {
                if (!current.ProgressionFacts.Contains(
                        IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId))
                {
                    yield return current.WithProgressionFact(
                        IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId);
                }
                else if (!current.ProgressionFacts.Contains(
                    IndustrialFactoryV2Ruleset.ExtractionReadyFactId))
                {
                    yield return current.WithProgressionFact(
                        IndustrialFactoryV2Ruleset.ExtractionReadyFactId);
                }
            }

            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                if (string.Equals(edge.FromRegionId, current.RegionId, StringComparison.Ordinal)
                    && DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, predicateState))
                {
                    yield return current.WithRegion(edge.ToRegionId);
                }

                if (reversibleEdges.Contains(edge.Id)
                    && string.Equals(edge.ToRegionId, current.RegionId, StringComparison.Ordinal)
                    && DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, predicateState))
                {
                    yield return current.WithRegion(edge.FromRegionId);
                }
            }

            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                if (!anchors.TryGetValue(discovery.LocationAnchorId, out DungeonAnchorPlanV2 anchor)
                    || !string.Equals(anchor.RegionId, current.RegionId, StringComparison.Ordinal)
                    || current.DiscoveryFacts.Contains(discovery.Id)
                    || !DungeonPredicateEvaluatorV2.Evaluate(discovery.AccessPredicate, predicateState)
                    || !AffectsRoutes(discovery, routeDiscoveryFacts))
                {
                    continue;
                }

                SolverState collected = current.WithDiscovery(discovery.Id);
                if (string.Equals(
                    discovery.DurableRewardId,
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                    StringComparison.Ordinal))
                {
                    collected = collected.WithRequiredItem(IndustrialFactoryV2Ruleset.CredentialKeyRewardId);
                }

                if (discovery.Kind == DungeonDiscoveryKindV2.Shortcut
                    && !string.IsNullOrWhiteSpace(discovery.DurableRewardId))
                {
                    collected = collected.WithShortcut(discovery.DurableRewardId);
                }

                yield return collected;
            }

            foreach (DungeonShortcutPlanV2 shortcut in plan.Shortcuts)
            {
                if (!string.Equals(shortcut.ActivationRegionId, current.RegionId, StringComparison.Ordinal)
                    || current.Shortcuts.Contains(shortcut.Id)
                    || !DungeonPredicateEvaluatorV2.Evaluate(
                        shortcut.EarliestAuthorizationPredicate,
                        predicateState)
                    || !DungeonPredicateEvaluatorV2.Evaluate(
                        shortcut.EnvironmentStatePredicate,
                        predicateState))
                {
                    continue;
                }

                yield return current.WithShortcut(shortcut.Id);
            }

            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            {
                if (!controllerConsoleRegions.TryGetValue(controller.Id, out HashSet<string> consoleRegions)
                    || !consoleRegions.Contains(current.RegionId)
                    || !current.ControllerStates.TryGetValue(controller.Id, out string currentControllerState))
                {
                    continue;
                }

                foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
                {
                    if (string.Equals(transition.FromStateId, currentControllerState, StringComparison.Ordinal)
                        && DungeonPredicateEvaluatorV2.Evaluate(transition.ActivationPredicate, predicateState))
                    {
                        yield return current.WithControllerState(controller.Id, transition.ToStateId);
                    }
                }
            }
        }

        private static bool AffectsRoutes(
            DungeonDiscoveryPlanV2 discovery,
            ISet<string> routeDiscoveryFacts)
        {
            return routeDiscoveryFacts.Contains(discovery.Id)
                || discovery.Kind == DungeonDiscoveryKindV2.Shortcut
                || string.Equals(
                    discovery.DurableRewardId,
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                    StringComparison.Ordinal);
        }

        private static HashSet<string> CollectReferencedDiscoveryFacts(DungeonPlanV2 plan)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAccessPredicateV2 predicate in EnumeratePredicates(plan))
            {
                foreach (DungeonPredicateClauseV2 clause in predicate.Clauses)
                {
                    foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                    {
                        if (condition.Kind == DungeonPredicateConditionKindV2.DiscoveryFact)
                        {
                            result.Add(condition.SubjectId);
                        }
                    }
                }
            }

            return result;
        }

        private static IEnumerable<DungeonAccessPredicateV2> EnumeratePredicates(DungeonPlanV2 plan)
        {
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges) yield return edge.AccessPredicate;
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                yield return discovery.AccessPredicate;
                yield return discovery.RevealPredicate;
            }
            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
                yield return transition.ActivationPredicate;
            foreach (DungeonShortcutPlanV2 shortcut in plan.Shortcuts)
            {
                yield return shortcut.EarliestAuthorizationPredicate;
                yield return shortcut.EnvironmentStatePredicate;
            }
        }

        private static IEnumerable<string> ValidateProtectedBoundaries(
            DungeonPlanV2 plan,
            IEnumerable<SolverState> states)
        {
            DungeonTraversalEdgePlanV2[] protectedEdges = plan.TraversalEdges
                .Where(value => value.IsProtectedProgressionBoundary)
                .ToArray();
            if (protectedEdges.Length == 0) yield break;
            SolverState[] stateArray = states.ToArray();
            var reportedFarSideStates = new HashSet<string>(StringComparer.Ordinal);
            var reportedPhysicalBypasses = new HashSet<string>(StringComparer.Ordinal);
            var physicalTransitionCache = new Dictionary<string, bool>(StringComparer.Ordinal);

            foreach (SolverState state in stateArray)
            {
                DungeonPredicateStateV2 predicate = state.ToPredicateState();
                foreach (DungeonTraversalEdgePlanV2 edge in protectedEdges)
                {
                    if (string.Equals(state.RegionId, edge.ToRegionId, StringComparison.Ordinal)
                        && !DungeonPredicateEvaluatorV2.Evaluate(edge.AccessPredicate, predicate)
                        && reportedFarSideStates.Add(edge.ToRegionId))
                    {
                        yield return edge.Id + ": unauthorized far-side state " + state.Key;
                    }
                }
            }

            foreach (DungeonTraversalEdgePlanV2 edge in protectedEdges)
            {
                var unauthorizedGroups = stateArray
                    .Where(state => !string.Equals(state.RegionId, edge.ToRegionId, StringComparison.Ordinal)
                        && !DungeonPredicateEvaluatorV2.Evaluate(
                            edge.AccessPredicate,
                            state.ToPredicateState()))
                    .GroupBy(
                        state => BuildPhysicalSurfaceStateKey(plan, state.ToPredicateState()),
                        StringComparer.Ordinal);
                foreach (IGrouping<string, SolverState> group in unauthorizedGroups)
                {
                    SolverState representative = group.First();
                    var startRegions = new HashSet<string>(
                        group.Select(value => value.RegionId),
                        StringComparer.Ordinal);
                    DungeonSurfacePlanV2[] activeSurfaces = plan.Surfaces
                        .Where(surface => DungeonPredicateEvaluatorV2.Evaluate(
                            surface.ActivePredicate,
                            representative.ToPredicateState()))
                        .ToArray();
                    if (!TryFindPhysicalPathFromAny(
                        plan,
                        startRegions,
                        edge.ToRegionId,
                        activeSurfaces,
                        physicalTransitionCache,
                        out string bypassSourceRegionId))
                    {
                        continue;
                    }

                    string bypassKey = group.Key + ":" + bypassSourceRegionId + "->" + edge.ToRegionId;
                    if (reportedPhysicalBypasses.Add(bypassKey))
                    {
                        SolverState sourceState = group.FirstOrDefault(value => string.Equals(
                                value.RegionId,
                                bypassSourceRegionId,
                                StringComparison.Ordinal))
                            ?? representative;
                        yield return edge.Id + ": undeclared physical bypass from " + bypassSourceRegionId
                            + " to protected far side " + edge.ToRegionId + " is possible before authorization in "
                            + sourceState.Key;
                    }
                }
            }
        }

        private static string BuildPhysicalSurfaceStateKey(
            DungeonPlanV2 plan,
            DungeonPredicateStateV2 state)
        {
            return string.Join(",", plan.Surfaces
                .Where(surface => DungeonPredicateEvaluatorV2.Evaluate(surface.ActivePredicate, state))
                .Select(surface => surface.Id)
                .OrderBy(value => value, StringComparer.Ordinal));
        }

        private static string BuildPhysicalPairStateKey(
            string fromRegionId,
            string toRegionId,
            IEnumerable<DungeonSurfacePlanV2> activeSurfaces)
        {
            return fromRegionId + "->" + toRegionId + "|"
                + string.Join(",", activeSurfaces
                    .Where(surface => string.Equals(surface.RegionId, fromRegionId, StringComparison.Ordinal)
                        || string.Equals(surface.RegionId, toRegionId, StringComparison.Ordinal)
                        || (surface.IsStructural && !surface.IsWalkable))
                    .Select(surface => surface.Id)
                    .OrderBy(value => value, StringComparer.Ordinal));
        }

        private static bool TryFindPhysicalPathFromAny(
            DungeonPlanV2 plan,
            ISet<string> startRegionIds,
            string targetRegionId,
            IReadOnlyList<DungeonSurfacePlanV2> activeSurfaces,
            IDictionary<string, bool> transitionCache,
            out string targetPredecessorRegionId)
        {
            targetPredecessorRegionId = null;
            DungeonRegionPlanV2[] regions = plan.Regions
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            var byId = regions.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var visited = new HashSet<string>(StringComparer.Ordinal) { targetRegionId };
            var queue = new Queue<string>();
            queue.Enqueue(targetRegionId);
            while (queue.Count > 0)
            {
                string current = queue.Dequeue();
                DungeonRegionPlanV2 currentRegion = byId[current];
                foreach (DungeonRegionPlanV2 candidate in regions)
                {
                    if (visited.Contains(candidate.Id)
                        || !RegionBoundsPermitPhysicalTransition(candidate.Bounds, currentRegion.Bounds))
                    {
                        continue;
                    }

                    string pairStateKey = BuildPhysicalPairStateKey(
                        candidate.Id,
                        current,
                        activeSurfaces);
                    if (!transitionCache.TryGetValue(pairStateKey, out bool canTransition))
                    {
                        canTransition = CanPhysicallyTransition(
                            candidate.Id,
                            current,
                            activeSurfaces);
                        transitionCache.Add(pairStateKey, canTransition);
                    }
                    if (!canTransition) continue;
                    if (startRegionIds.Contains(candidate.Id))
                    {
                        targetPredecessorRegionId = candidate.Id;
                        return true;
                    }
                    visited.Add(candidate.Id);
                    queue.Enqueue(candidate.Id);
                }
            }

            return false;
        }

        private static bool RegionBoundsPermitPhysicalTransition(DungeonBounds3 from, DungeonBounds3 to)
        {
            double gapX = AxisGap(from.Minimum.X, from.Maximum.X, to.Minimum.X, to.Maximum.X);
            double gapZ = AxisGap(from.Minimum.Z, from.Maximum.Z, to.Minimum.Z, to.Maximum.Z);
            double horizontal = Math.Sqrt(gapX * gapX + gapZ * gapZ);
            double rise = to.Minimum.Y - from.Maximum.Y;
            double drop = from.Minimum.Y - to.Maximum.Y;
            return horizontal <= IndustrialFactoryV2Ruleset.MaximumCertifiedPhysicalTransition + 1e-9d
                && rise <= TraversalProfilesV2.Flooded.MaximumLedgeCatchRise + 1e-9d
                && drop <= WaterEntryResponseV2.IndustrialFactory.MaximumAuthoredCatchmentFall + 1e-9d;
        }

        private static bool CanPhysicallyTransition(
            string fromRegionId,
            string toRegionId,
            IReadOnlyList<DungeonSurfacePlanV2> activeSurfaces)
        {
            DungeonSurfacePlanV2[] sourceSurfaces = activeSurfaces
                .Where(surface => string.Equals(surface.RegionId, fromRegionId, StringComparison.Ordinal)
                    && surface.IsStructural
                    && surface.IsWalkable
                    && surface.Kind != DungeonSurfaceKindV2.Hazard)
                .ToArray();
            DungeonSurfacePlanV2[] destinationSurfaces = activeSurfaces
                .Where(surface => string.Equals(surface.RegionId, toRegionId, StringComparison.Ordinal)
                    && surface.IsStructural
                    && surface.IsWalkable
                    && surface.Kind != DungeonSurfaceKindV2.Hazard)
                .ToArray();
            if (sourceSurfaces.Length == 0 || destinationSurfaces.Length == 0) return false;

            DungeonSurfacePlanV2[] collisionSurfaces = activeSurfaces
                .Where(surface => surface.IsStructural
                    || surface.Kind == DungeonSurfaceKindV2.SolidOccupancy)
                .ToArray();
            // Flooded is the certified superset for this profile: capsule
            // dimensions are identical to Dry while vertical reach is larger.
            // Proving the geometry closed against Flooded also proves it
            // closed for Dry without evaluating the same candidate corpus a
            // second time.
            TraversalProfileV2[] capabilityProfiles = { TraversalProfilesV2.Flooded };
            foreach (TraversalProfileV2 profile in capabilityProfiles)
            foreach (DungeonSurfacePlanV2 source in sourceSurfaces)
            foreach (DungeonSurfacePlanV2 destination in destinationSurfaces)
            {
                if (CanTraverseSurfacePair(
                    source,
                    destination,
                    collisionSurfaces,
                    profile))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool CanTraverseSurfacePair(
            DungeonSurfacePlanV2 source,
            DungeonSurfacePlanV2 destination,
            IReadOnlyList<DungeonSurfacePlanV2> collisionSurfaces,
            TraversalProfileV2 profile)
        {
            double sourceFootY = source.Volume.MaximumY;
            double destinationFootY = destination.Volume.MaximumY;
            double rise = destinationFootY - sourceFootY;
            double drop = sourceFootY - destinationFootY;
            if (rise > profile.MaximumLedgeCatchRise + 1e-9d
                || drop > WaterEntryResponseV2.IndustrialFactory.MaximumAuthoredCatchmentFall + 1e-9d)
            {
                return false;
            }

            IReadOnlyList<DungeonPoint2V2> sourceFootprint = ErodePhysicalFootprint(
                source.Volume.HorizontalVertices,
                profile.CapsuleRadius);
            IReadOnlyList<DungeonPoint2V2> destinationFootprint = ErodePhysicalFootprint(
                destination.Volume.HorizontalVertices,
                profile.CapsuleRadius);
            if (sourceFootprint.Count < 3 || destinationFootprint.Count < 3) return false;

            DungeonSurfacePlanV2[] blockers = collisionSurfaces
                .Where(surface => !string.Equals(surface.Id, source.Id, StringComparison.Ordinal)
                    && !string.Equals(surface.Id, destination.Id, StringComparison.Ordinal)
                    && SurfaceCouldAffectTransition(surface, sourceFootY, destinationFootY, profile)
                    && SurfaceOverlapsPairCorridor(
                        surface,
                        source.Volume.HorizontalVertices,
                        destination.Volume.HorizontalVertices,
                        profile.CapsuleRadius))
                .ToArray();
            DungeonSurfacePlanV2[] apertureBlockers = blockers
                .Where(surface => !surface.IsWalkable)
                .ToArray();
            IReadOnlyList<DungeonPoint2V2> sourceCandidates = BuildPhysicalCandidates(
                sourceFootprint,
                apertureBlockers);
            IReadOnlyList<DungeonPoint2V2> destinationCandidates = BuildPhysicalCandidates(
                destinationFootprint,
                apertureBlockers);

            foreach (PhysicalCandidatePair candidate in BuildPhysicalCandidatePairs(
                sourceCandidates,
                destinationCandidates,
                sourceFootprint,
                destinationFootprint))
            {
                double deltaX = candidate.To.X - candidate.From.X;
                double deltaZ = candidate.To.Z - candidate.From.Z;
                double horizontalDistance = Math.Sqrt(deltaX * deltaX + deltaZ * deltaZ);
                if (horizontalDistance
                        > IndustrialFactoryV2Ruleset.MaximumCertifiedPhysicalTransition + 1e-9d
                    || (rise > 0.35d
                        && PointInsideConvex(
                            candidate.From.X,
                            candidate.From.Z,
                            destination.Volume.HorizontalVertices,
                            0d)))
                {
                    continue;
                }

                if (!HasPhysicalStandingClearance(
                        candidate.From,
                        sourceFootY,
                        source.Id,
                        destination.Id,
                        blockers,
                        profile)
                    || !HasPhysicalStandingClearance(
                        candidate.To,
                        destinationFootY,
                        source.Id,
                        destination.Id,
                        blockers,
                        profile)
                    || PhysicalPathIsBlocked(
                        candidate.From,
                        candidate.To,
                        sourceFootY,
                        destinationFootY,
                        blockers,
                        profile))
                {
                    continue;
                }

                return true;
            }

            return false;
        }

        private static bool SurfaceCouldAffectTransition(
            DungeonSurfacePlanV2 surface,
            double sourceFootY,
            double destinationFootY,
            TraversalProfileV2 profile)
        {
            double lowestFoot = Math.Min(sourceFootY, destinationFootY);
            double highestBody = Math.Max(
                    sourceFootY + profile.JumpHeight,
                    destinationFootY)
                + profile.HeadClearance;
            return surface.Volume.MaximumY > lowestFoot + 1e-9d
                && surface.Volume.MinimumY < highestBody - 1e-9d;
        }

        private static bool SurfaceOverlapsPairCorridor(
            DungeonSurfacePlanV2 surface,
            IReadOnlyList<DungeonPoint2V2> source,
            IReadOnlyList<DungeonPoint2V2> destination,
            double expansion)
        {
            double corridorMinimumX = Math.Min(source.Min(value => value.X), destination.Min(value => value.X)) - expansion;
            double corridorMaximumX = Math.Max(source.Max(value => value.X), destination.Max(value => value.X)) + expansion;
            double corridorMinimumZ = Math.Min(source.Min(value => value.Z), destination.Min(value => value.Z)) - expansion;
            double corridorMaximumZ = Math.Max(source.Max(value => value.Z), destination.Max(value => value.Z)) + expansion;
            return surface.Volume.HorizontalVertices.Max(value => value.X) >= corridorMinimumX - 1e-9d
                && surface.Volume.HorizontalVertices.Min(value => value.X) <= corridorMaximumX + 1e-9d
                && surface.Volume.HorizontalVertices.Max(value => value.Z) >= corridorMinimumZ - 1e-9d
                && surface.Volume.HorizontalVertices.Min(value => value.Z) <= corridorMaximumZ + 1e-9d;
        }

        private static bool HasPhysicalStandingClearance(
            DungeonPoint2V2 point,
            double footY,
            string sourceSurfaceId,
            string destinationSurfaceId,
            IEnumerable<DungeonSurfacePlanV2> blockers,
            TraversalProfileV2 profile)
        {
            double bodyTop = footY + profile.HeadClearance;
            foreach (DungeonSurfacePlanV2 blocker in blockers)
            {
                if (string.Equals(blocker.Id, sourceSurfaceId, StringComparison.Ordinal)
                    || string.Equals(blocker.Id, destinationSurfaceId, StringComparison.Ordinal)
                    || blocker.Volume.MaximumY <= footY + 1e-9d
                    || blocker.Volume.MinimumY >= bodyTop - 1e-9d
                    || DistanceSquaredPointToConvex(point, blocker.Volume.HorizontalVertices)
                        > profile.CapsuleRadius * profile.CapsuleRadius + 1e-12d)
                {
                    continue;
                }

                return false;
            }

            return true;
        }

        private static bool PhysicalPathIsBlocked(
            DungeonPoint2V2 from,
            DungeonPoint2V2 to,
            double sourceFootY,
            double destinationFootY,
            IEnumerable<DungeonSurfacePlanV2> blockers,
            TraversalProfileV2 profile)
        {
            double jumpApexFootY = sourceFootY + profile.JumpHeight;
            double maximumBodyY = Math.Max(jumpApexFootY, destinationFootY) + profile.HeadClearance;
            double lowestFootY = Math.Min(sourceFootY, destinationFootY);
            double radiusSquared = profile.CapsuleRadius * profile.CapsuleRadius;
            foreach (DungeonSurfacePlanV2 blocker in blockers)
            {
                if (blocker.Volume.MaximumY <= lowestFootY + 1e-9d
                    || blocker.Volume.MinimumY >= maximumBodyY - 1e-9d
                    || DistanceSquaredSegmentToConvex(from, to, blocker.Volume.HorizontalVertices)
                        > radiusSquared + 1e-12d)
                {
                    continue;
                }

                // A low obstruction is a jumpable part of the derived
                // geometry. Taller walls, gate frames, and overhead solids
                // remain blockers; another overhead surface will separately
                // reject a low-wall jump whose capsule lacks headroom.
                if (blocker.Volume.MinimumY <= sourceFootY + 1e-9d
                    && blocker.Volume.MaximumY < jumpApexFootY - 1e-9d)
                {
                    continue;
                }

                return true;
            }

            return false;
        }

        private static IReadOnlyList<DungeonPoint2V2> BuildPhysicalCandidates(
            IReadOnlyList<DungeonPoint2V2> footprint,
            IEnumerable<DungeonSurfacePlanV2> blockers)
        {
            var result = new List<DungeonPoint2V2>();
            AddPhysicalPoint(result, PolygonCentroid(footprint));
            DungeonPoint2V2[] blockerVertices = blockers
                .SelectMany(surface => surface.Volume.HorizontalVertices)
                .ToArray();
            for (int edgeIndex = 0; edgeIndex < footprint.Count; edgeIndex += 1)
            {
                DungeonPoint2V2 a = footprint[edgeIndex];
                DungeonPoint2V2 b = footprint[(edgeIndex + 1) % footprint.Count];
                var parameters = new List<double> { 0d, 0.5d, 1d };
                double edgeX = b.X - a.X;
                double edgeZ = b.Z - a.Z;
                double lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
                if (lengthSquared > 1e-18d)
                {
                    foreach (DungeonPoint2V2 blockerVertex in blockerVertices)
                    {
                        double t = ((blockerVertex.X - a.X) * edgeX
                            + (blockerVertex.Z - a.Z) * edgeZ) / lengthSquared;
                        if (t > 1e-9d && t < 1d - 1e-9d)
                        {
                            DungeonPoint2V2 projection = Lerp(a, b, t);
                            double maximumCriticalDistance =
                                IndustrialFactoryV2Ruleset.MaximumCertifiedPhysicalTransition
                                + TraversalProfilesV2.Dry.CapsuleRadius;
                            if (DistanceSquared(blockerVertex, projection)
                                <= maximumCriticalDistance * maximumCriticalDistance + 1e-9d)
                            {
                                parameters.Add(t);
                            }
                        }
                    }
                }

                double[] ordered = parameters
                    .OrderBy(value => value)
                    .Aggregate(new List<double>(), (values, value) =>
                    {
                        if (values.Count == 0 || Math.Abs(values[values.Count - 1] - value) > 1e-9d)
                        {
                            values.Add(value);
                        }
                        return values;
                    })
                    .ToArray();
                for (int index = 0; index < ordered.Length; index += 1)
                {
                    AddPhysicalPoint(result, Lerp(a, b, ordered[index]));
                    if (index + 1 < ordered.Length)
                    {
                        AddPhysicalPoint(result, Lerp(a, b, (ordered[index] + ordered[index + 1]) * 0.5d));
                    }
                }
            }

            return Array.AsReadOnly(result
                .OrderBy(value => value.X)
                .ThenBy(value => value.Z)
                .ToArray());
        }

        private static IEnumerable<PhysicalCandidatePair> BuildPhysicalCandidatePairs(
            IReadOnlyList<DungeonPoint2V2> sourceCandidates,
            IReadOnlyList<DungeonPoint2V2> destinationCandidates,
            IReadOnlyList<DungeonPoint2V2> sourceFootprint,
            IReadOnlyList<DungeonPoint2V2> destinationFootprint)
        {
            var pairs = new List<PhysicalCandidatePair>();
            foreach (DungeonPoint2V2 point in sourceCandidates)
            {
                AddPhysicalPair(pairs, point, ClosestPointOnPolygon(point, destinationFootprint));
            }
            foreach (DungeonPoint2V2 point in destinationCandidates)
            {
                AddPhysicalPair(pairs, ClosestPointOnPolygon(point, sourceFootprint), point);
            }
            return pairs;
        }

        private static IReadOnlyList<DungeonPoint2V2> ErodePhysicalFootprint(
            IReadOnlyList<DungeonPoint2V2> polygon,
            double erosion)
        {
            if (polygon == null || polygon.Count < 3) return Array.Empty<DungeonPoint2V2>();
            double winding = Math.Sign(PhysicalSignedAreaTwice(polygon));
            if (winding == 0d) return Array.Empty<DungeonPoint2V2>();
            List<DungeonPoint2V2> result = polygon.ToList();
            for (int edgeIndex = 0; edgeIndex < polygon.Count && result.Count >= 3; edgeIndex += 1)
            {
                DungeonPoint2V2 a = polygon[edgeIndex];
                DungeonPoint2V2 b = polygon[(edgeIndex + 1) % polygon.Count];
                result = ClipPhysicalHalfPlane(result, a, b, winding, erosion);
            }
            return result.Count >= 3
                ? (IReadOnlyList<DungeonPoint2V2>)Array.AsReadOnly(result.ToArray())
                : Array.Empty<DungeonPoint2V2>();
        }

        private static List<DungeonPoint2V2> ClipPhysicalHalfPlane(
            IReadOnlyList<DungeonPoint2V2> subject,
            DungeonPoint2V2 edgeStart,
            DungeonPoint2V2 edgeEnd,
            double winding,
            double erosion)
        {
            var result = new List<DungeonPoint2V2>();
            if (subject.Count == 0) return result;
            double edgeX = edgeEnd.X - edgeStart.X;
            double edgeZ = edgeEnd.Z - edgeStart.Z;
            double edgeLength = Math.Sqrt(edgeX * edgeX + edgeZ * edgeZ);
            DungeonPoint2V2 previous = subject[subject.Count - 1];
            double previousValue = PhysicalHalfPlaneValue(
                previous, edgeStart, edgeX, edgeZ, edgeLength, winding, erosion);
            bool previousInside = previousValue >= -1e-12d;
            foreach (DungeonPoint2V2 current in subject)
            {
                double currentValue = PhysicalHalfPlaneValue(
                    current, edgeStart, edgeX, edgeZ, edgeLength, winding, erosion);
                bool currentInside = currentValue >= -1e-12d;
                if (currentInside != previousInside)
                {
                    double denominator = previousValue - currentValue;
                    if (Math.Abs(denominator) > 1e-18d)
                    {
                        double t = previousValue / denominator;
                        AddPhysicalPoint(result, Lerp(previous, current, t));
                    }
                }
                if (currentInside) AddPhysicalPoint(result, current);
                previous = current;
                previousValue = currentValue;
                previousInside = currentInside;
            }
            if (result.Count > 1 && SamePhysicalPoint(result[0], result[result.Count - 1]))
            {
                result.RemoveAt(result.Count - 1);
            }
            return result;
        }

        private static double PhysicalHalfPlaneValue(
            DungeonPoint2V2 point,
            DungeonPoint2V2 edgeStart,
            double edgeX,
            double edgeZ,
            double edgeLength,
            double winding,
            double erosion)
        {
            return winding * (edgeX * (point.Z - edgeStart.Z) - edgeZ * (point.X - edgeStart.X))
                - erosion * edgeLength;
        }

        private static double PhysicalSignedAreaTwice(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            double area = 0d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                area += a.X * b.Z - b.X * a.Z;
            }
            return area;
        }

        private static DungeonPoint2V2 PolygonCentroid(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            return new DungeonPoint2V2(
                polygon.Average(value => value.X),
                polygon.Average(value => value.Z));
        }

        private static DungeonPoint2V2 ClosestPointOnPolygon(
            DungeonPoint2V2 point,
            IReadOnlyList<DungeonPoint2V2> polygon)
        {
            if (PointInsideConvex(point.X, point.Z, polygon, 0d)) return point;
            DungeonPoint2V2 closest = polygon[0];
            double closestDistance = double.PositiveInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 candidate = ClosestPointOnSegment(
                    point,
                    polygon[index],
                    polygon[(index + 1) % polygon.Count]);
                double distance = DistanceSquared(point, candidate);
                if (distance < closestDistance - 1e-12d)
                {
                    closest = candidate;
                    closestDistance = distance;
                }
            }
            return closest;
        }

        private static DungeonPoint2V2 ClosestPointOnSegment(
            DungeonPoint2V2 point,
            DungeonPoint2V2 a,
            DungeonPoint2V2 b)
        {
            double edgeX = b.X - a.X;
            double edgeZ = b.Z - a.Z;
            double lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
            if (lengthSquared <= 1e-18d) return a;
            double t = ((point.X - a.X) * edgeX + (point.Z - a.Z) * edgeZ) / lengthSquared;
            t = Math.Max(0d, Math.Min(1d, t));
            return Lerp(a, b, t);
        }

        private static double DistanceSquaredPointToConvex(
            DungeonPoint2V2 point,
            IReadOnlyList<DungeonPoint2V2> polygon)
        {
            if (PointInsideConvex(point.X, point.Z, polygon, 0d)) return 0d;
            double result = double.PositiveInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                result = Math.Min(result, DistanceSquared(
                    point,
                    ClosestPointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.Count])));
            }
            return result;
        }

        private static double DistanceSquaredSegmentToConvex(
            DungeonPoint2V2 from,
            DungeonPoint2V2 to,
            IReadOnlyList<DungeonPoint2V2> polygon)
        {
            if (PointInsideConvex(from.X, from.Z, polygon, 0d)
                || PointInsideConvex(to.X, to.Z, polygon, 0d)) return 0d;
            double result = double.PositiveInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                result = Math.Min(result, DistanceSquaredBetweenSegments(
                    from,
                    to,
                    polygon[index],
                    polygon[(index + 1) % polygon.Count]));
                if (result <= 1e-18d) return 0d;
            }
            return result;
        }

        private static double DistanceSquaredBetweenSegments(
            DungeonPoint2V2 a,
            DungeonPoint2V2 b,
            DungeonPoint2V2 c,
            DungeonPoint2V2 d)
        {
            if (PhysicalSegmentsIntersect(a, b, c, d)) return 0d;
            return Math.Min(
                Math.Min(DistanceSquared(a, ClosestPointOnSegment(a, c, d)),
                    DistanceSquared(b, ClosestPointOnSegment(b, c, d))),
                Math.Min(DistanceSquared(c, ClosestPointOnSegment(c, a, b)),
                    DistanceSquared(d, ClosestPointOnSegment(d, a, b))));
        }

        private static bool PhysicalSegmentsIntersect(
            DungeonPoint2V2 a,
            DungeonPoint2V2 b,
            DungeonPoint2V2 c,
            DungeonPoint2V2 d)
        {
            double abC = PhysicalCross(a, b, c);
            double abD = PhysicalCross(a, b, d);
            double cdA = PhysicalCross(c, d, a);
            double cdB = PhysicalCross(c, d, b);
            if (((abC > 1e-12d && abD < -1e-12d) || (abC < -1e-12d && abD > 1e-12d))
                && ((cdA > 1e-12d && cdB < -1e-12d) || (cdA < -1e-12d && cdB > 1e-12d)))
            {
                return true;
            }
            return (Math.Abs(abC) <= 1e-12d && PhysicalPointOnSegment(c, a, b))
                || (Math.Abs(abD) <= 1e-12d && PhysicalPointOnSegment(d, a, b))
                || (Math.Abs(cdA) <= 1e-12d && PhysicalPointOnSegment(a, c, d))
                || (Math.Abs(cdB) <= 1e-12d && PhysicalPointOnSegment(b, c, d));
        }

        private static bool PhysicalPointOnSegment(
            DungeonPoint2V2 point,
            DungeonPoint2V2 a,
            DungeonPoint2V2 b)
        {
            return point.X >= Math.Min(a.X, b.X) - 1e-12d
                && point.X <= Math.Max(a.X, b.X) + 1e-12d
                && point.Z >= Math.Min(a.Z, b.Z) - 1e-12d
                && point.Z <= Math.Max(a.Z, b.Z) + 1e-12d;
        }

        private static double PhysicalCross(
            DungeonPoint2V2 a,
            DungeonPoint2V2 b,
            DungeonPoint2V2 point)
        {
            return (b.X - a.X) * (point.Z - a.Z) - (b.Z - a.Z) * (point.X - a.X);
        }

        private static double DistanceSquared(DungeonPoint2V2 a, DungeonPoint2V2 b)
        {
            double x = b.X - a.X;
            double z = b.Z - a.Z;
            return x * x + z * z;
        }

        private static DungeonPoint2V2 Lerp(DungeonPoint2V2 a, DungeonPoint2V2 b, double t)
        {
            return new DungeonPoint2V2(a.X + (b.X - a.X) * t, a.Z + (b.Z - a.Z) * t);
        }

        private static void AddPhysicalPoint(ICollection<DungeonPoint2V2> points, DungeonPoint2V2 point)
        {
            if (!points.Any(existing => SamePhysicalPoint(existing, point))) points.Add(point);
        }

        private static void AddPhysicalPair(
            ICollection<PhysicalCandidatePair> pairs,
            DungeonPoint2V2 from,
            DungeonPoint2V2 to)
        {
            if (!pairs.Any(existing => SamePhysicalPoint(existing.From, from)
                    && SamePhysicalPoint(existing.To, to)))
            {
                pairs.Add(new PhysicalCandidatePair(from, to));
            }
        }

        private static bool SamePhysicalPoint(DungeonPoint2V2 a, DungeonPoint2V2 b)
        {
            return Math.Abs(a.X - b.X) <= 1e-9d && Math.Abs(a.Z - b.Z) <= 1e-9d;
        }

        private readonly struct PhysicalCandidatePair
        {
            public PhysicalCandidatePair(DungeonPoint2V2 from, DungeonPoint2V2 to)
            {
                From = from;
                To = to;
            }

            public DungeonPoint2V2 From { get; }
            public DungeonPoint2V2 To { get; }
        }

        private static double AxisGap(double aMin, double aMax, double bMin, double bMax)
        {
            if (aMax < bMin) return bMin - aMax;
            if (bMax < aMin) return aMin - bMax;
            return 0d;
        }

        private static HashSet<string> ReverseReachable(
            IEnumerable<string> goals,
            IReadOnlyDictionary<string, HashSet<string>> adjacency)
        {
            var reverse = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, HashSet<string>> pair in adjacency)
            {
                foreach (string target in pair.Value)
                {
                    if (!reverse.TryGetValue(target, out List<string> predecessors))
                    {
                        predecessors = new List<string>();
                        reverse.Add(target, predecessors);
                    }
                    predecessors.Add(pair.Key);
                }
            }

            var result = new HashSet<string>(goals, StringComparer.Ordinal);
            var queue = new Queue<string>(result);
            while (queue.Count > 0)
            {
                string current = queue.Dequeue();
                if (!reverse.TryGetValue(current, out List<string> predecessors)) continue;
                foreach (string predecessor in predecessors)
                {
                    if (result.Add(predecessor)) queue.Enqueue(predecessor);
                }
            }
            return result;
        }

        private static void AddState(
            SolverState state,
            IDictionary<string, SolverState> states,
            IDictionary<string, HashSet<string>> adjacency,
            Queue<SolverState> queue)
        {
            states.Add(state.Key, state);
            adjacency.Add(state.Key, new HashSet<string>(StringComparer.Ordinal));
            queue.Enqueue(state);
        }

        internal static bool PointInsideConvex(
            double x,
            double z,
            IReadOnlyList<DungeonPoint2V2> polygon,
            double erosion)
        {
            double signedAreaTwice = 0d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                signedAreaTwice += a.X * b.Z - b.X * a.Z;
            }
            double winding = Math.Sign(signedAreaTwice);
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                double edgeX = b.X - a.X;
                double edgeZ = b.Z - a.Z;
                double length = Math.Sqrt(edgeX * edgeX + edgeZ * edgeZ);
                double cross = edgeX * (z - a.Z) - edgeZ * (x - a.X);
                if (cross * winding < erosion * length - 1e-9d) return false;
            }
            return true;
        }

        private sealed class SolverState
        {
            private SolverState(
                string regionId,
                IEnumerable<string> items,
                IEnumerable<string> shortcuts,
                IEnumerable<string> discoveryFacts,
                IEnumerable<string> progressionFacts,
                IEnumerable<KeyValuePair<string, string>> controllerStates)
            {
                RegionId = regionId;
                RequiredItems = new SortedSet<string>(items, StringComparer.Ordinal);
                Shortcuts = new SortedSet<string>(shortcuts, StringComparer.Ordinal);
                DiscoveryFacts = new SortedSet<string>(discoveryFacts, StringComparer.Ordinal);
                ProgressionFacts = new SortedSet<string>(progressionFacts, StringComparer.Ordinal);
                ControllerStates = new SortedDictionary<string, string>(StringComparer.Ordinal);
                foreach (KeyValuePair<string, string> pair in controllerStates) ControllerStates[pair.Key] = pair.Value;
            }

            public string RegionId { get; }
            public SortedSet<string> RequiredItems { get; }
            public SortedSet<string> Shortcuts { get; }
            public SortedSet<string> DiscoveryFacts { get; }
            public SortedSet<string> ProgressionFacts { get; }
            public SortedDictionary<string, string> ControllerStates { get; }
            public string Key => RegionId
                + "|i=" + string.Join(",", RequiredItems)
                + "|c=" + string.Join(",", ControllerStates.Select(value => value.Key + "=" + value.Value))
                + "|s=" + string.Join(",", Shortcuts)
                + "|d=" + string.Join(",", DiscoveryFacts)
                + "|p=" + string.Join(",", ProgressionFacts);

            public static SolverState CreateInitial(DungeonPlanV2 plan)
            {
                return new SolverState(
                    plan.EntranceRegionId,
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    plan.EnvironmentControllers.Select(value =>
                        new KeyValuePair<string, string>(value.Id, value.InitialStateId)));
            }

            public SolverState WithRegion(string regionId) => Copy(regionId);
            public SolverState WithRequiredItem(string id) => Copy(RegionId, addItem: id);
            public SolverState WithShortcut(string id) => Copy(RegionId, addShortcut: id);
            public SolverState WithDiscovery(string id) => Copy(RegionId, addDiscovery: id);
            public SolverState WithProgressionFact(string id) => Copy(RegionId, addProgressionFact: id);
            public SolverState WithControllerState(string id, string state) => Copy(RegionId, controllerId: id, controllerState: state);

            public DungeonPredicateStateV2 ToPredicateState()
            {
                return new DungeonPredicateStateV2(
                    RequiredItems,
                    ControllerStates.Select(value => new DungeonControllerStateFactV2(value.Key, value.Value)),
                    Shortcuts,
                    DiscoveryFacts,
                    ProgressionFacts,
                    new[] { TraversalProfilesV2.DryId, TraversalProfilesV2.FloodedId });
            }

            private SolverState Copy(
                string regionId,
                string addItem = null,
                string addShortcut = null,
                string addDiscovery = null,
                string addProgressionFact = null,
                string controllerId = null,
                string controllerState = null)
            {
                var items = new List<string>(RequiredItems);
                var shortcuts = new List<string>(Shortcuts);
                var discoveries = new List<string>(DiscoveryFacts);
                var progressionFacts = new List<string>(ProgressionFacts);
                var controllers = new Dictionary<string, string>(ControllerStates, StringComparer.Ordinal);
                if (addItem != null) items.Add(addItem);
                if (addShortcut != null) shortcuts.Add(addShortcut);
                if (addDiscovery != null) discoveries.Add(addDiscovery);
                if (addProgressionFact != null) progressionFacts.Add(addProgressionFact);
                if (controllerId != null) controllers[controllerId] = controllerState;
                return new SolverState(regionId, items, shortcuts, discoveries, progressionFacts, controllers);
            }
        }
    }

    /// <summary>
    /// Conservative static checks for authored fall volumes and safe landing
    /// footprints. Every safe anchor must fit inside a walkable collider top
    /// eroded by capsule radius plus the 0.1 landing margin.
    /// </summary>
    public sealed class DungeonFallCoverageValidatorV2
    {
        public const double LandingErosion = 0.52d;
        private const double GeometryEpsilon = 1e-12d;
        private const double CoverageAreaEpsilon = 1e-12d;

        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            Dictionary<string, DungeonSurfacePlanV2> surfaces = plan.Surfaces.ToDictionary(value => value.Id, StringComparer.Ordinal);
            Dictionary<string, DungeonAnchorPlanV2> anchors = plan.Anchors.ToDictionary(value => value.Id, StringComparer.Ordinal);
            Dictionary<string, DungeonFallCatchmentPlanV2> catchments = plan.FallCatchments.ToDictionary(value => value.Id, StringComparer.Ordinal);

            foreach (IndustrialFactoryV2ValidationIssue issue in new DungeonTraversalEnvelopeValidatorV2().Validate(plan))
            {
                errors.Add(issue);
            }

            ValidateFailureSurfaceSweeps(plan, errors);

            foreach (DungeonFallExposurePlanV2 exposure in plan.FallExposures)
            {
                if (!DungeonReactionEnvelopesV2.TryResolve(
                        exposure.ReactionEnvelopeId,
                        out DungeonReactionEnvelopeV2 reactionEnvelope)
                    || Math.Abs(
                        exposure.MaximumHorizontalDisplacement
                            - DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed) > 1e-9d
                    || !string.Equals(
                        exposure.MovementProfileVersion,
                        IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                        StringComparison.Ordinal))
                {
                    Add(errors, "REACTION_ENVELOPE_UNCERTIFIED", exposure.Id,
                        "Exposure must use the certified 1.5-strength, 8.1-horizontal-speed, 6.37-upward, "
                        + "12.5-rise-gravity, 1.08-fall-multiplier reaction envelope.");
                }
                else if ((exposure.Causes & DungeonFallExposureCauseV2.Knockback) != 0
                    && exposure.ConservativeFallVolume.MaximumY + 1e-9d
                        < exposure.SourceVolume.MaximumY + reactionEnvelope.MaximumRiseHeight)
                {
                    Add(errors, "REACTION_VERTICAL_SWEEP_UNCOVERED", exposure.Id,
                        "The conservative fall volume omits the certified knockback rise before descent.");
                }

                foreach (string catchmentId in exposure.RequiredCatchmentIds)
                {
                    if (!catchments.TryGetValue(catchmentId, out DungeonFallCatchmentPlanV2 catchment)) continue;
                    // ConservativeFallVolume is the swept corridor. It is not a
                    // promise that its constant prism projection is a landing
                    // pad. The exact terminal footprint is the convex
                    // intersection of that corridor with this catchment.
                    IReadOnlyList<DungeonPoint2V2> terminalFootprint = IntersectConvexPolygons(
                        exposure.ConservativeFallVolume.HorizontalVertices,
                        catchment.Volume.HorizontalVertices);
                    IReadOnlyList<DungeonPoint2V2> capsuleTerminalFootprint = ErodeConvexPolygon(
                        terminalFootprint,
                        LandingErosion);
                    if (capsuleTerminalFootprint.Count < 3
                        || !PolygonCoveredByUnion(
                            capsuleTerminalFootprint,
                            new[] { exposure.ConservativeFallVolume.HorizontalVertices })
                        || exposure.ConservativeFallVolume.MinimumY > catchment.Volume.MaximumY + 1e-9d)
                    {
                        Add(errors, "FALL_VOLUME_MISSES_CATCHMENT", exposure.Id,
                            "The swept corridor and " + catchment.Id
                            + " do not produce a non-empty, capsule-eroded terminal footprint wholly inside the corridor.");
                    }
                    else if (!PolygonCoveredByUnion(
                        capsuleTerminalFootprint,
                        BuildErodedSafeFootprints(catchment, surfaces)))
                    {
                        Add(errors, "FALL_TERMINAL_FOOTPRINT_UNCOVERED", exposure.Id,
                            "The exact capsule-eroded terminal footprint contains uncovered area or a collider hole.");
                    }

                    if (exposure.ConservativeFallVolume.MinimumY
                        < catchment.StructuralBottomY + exposure.StructuralBottomClearance - 1e-9d)
                    {
                        Add(errors, "FALL_VOLUME_REACHES_STRUCTURAL_BOTTOM", exposure.Id,
                            "The fall volume violates its structural-bottom clearance.");
                    }

                    double sourceTop = exposure.SourceVolume.MaximumY;
                    double landingTop = catchment.SafeSurfaceIds
                        .Where(surfaces.ContainsKey)
                        .Select(id => surfaces[id].Volume.MaximumY)
                        .DefaultIfEmpty(catchment.Volume.MinimumY)
                        .Max();
                    if (sourceTop - landingTop > WaterEntryResponseV2.IndustrialFactory.MaximumAuthoredCatchmentFall + 1e-9d
                        && catchment.Kind == DungeonFallCatchmentKindV2.WaterBasin)
                    {
                        Add(errors, "WATER_CATCHMENT_TOO_DEEP", exposure.Id,
                            "The authored water catch exceeds the certified 12-unit fall.");
                    }
                }
            }

            foreach (DungeonFallCatchmentPlanV2 catchment in plan.FallCatchments)
            {
                if (!anchors.TryGetValue(catchment.SafeAnchorId, out DungeonAnchorPlanV2 safeAnchor)) continue;
                IReadOnlyList<DungeonPoint2V2> capsuleCatchment = ErodeConvexPolygon(
                    catchment.Volume.HorizontalVertices,
                    LandingErosion);
                if (capsuleCatchment.Count < 3)
                {
                    Add(errors, "CATCHMENT_CAPSULE_FOOTPRINT_ERODED_AWAY", catchment.Id,
                        "The catchment has no capsule-center landing footprint after certified erosion.");
                }

                bool hasErodedSafeSurface = false;
                foreach (string surfaceId in catchment.SafeSurfaceIds)
                {
                    if (!surfaces.TryGetValue(surfaceId, out DungeonSurfacePlanV2 surface)
                        || !surface.IsWalkable
                        || surface.Kind == DungeonSurfaceKindV2.Hazard)
                    {
                        continue;
                    }

                    if (DungeonProgressionSolverV2.PointInsideConvex(
                        safeAnchor.Position.X,
                        safeAnchor.Position.Z,
                        surface.Volume.HorizontalVertices,
                        LandingErosion))
                    {
                        hasErodedSafeSurface = true;
                        break;
                    }
                }

                if (!hasErodedSafeSurface)
                {
                    Add(errors, "SAFE_PAD_CAPSULE_EROSION_FAILED", catchment.Id,
                        "No declared landing collider contains the safe anchor after capsule erosion.");
                }

                if (capsuleCatchment.Count < 3
                    || !LandingFootprintIsCovered(catchment, surfaces, capsuleCatchment))
                {
                    Add(errors, "CATCHMENT_LANDING_FOOTPRINT_UNCOVERED", catchment.Id,
                        "The capsule-eroded catchment contains uncovered area or a collider hole.");
                }

                if (catchment.Kind == DungeonFallCatchmentKindV2.WaterBasin)
                {
                    bool cushioned = plan.FluidZones.Any(value =>
                        string.Equals(value.RegionId, catchment.RegionId, StringComparison.Ordinal)
                        && value.MinimumCushioningDepth + 1e-9d >= WaterEntryResponseV2.IndustrialFactory.MinimumCushioningDepth);
                    if (!cushioned)
                    {
                        Add(errors, "WATER_CUSHION_DEPTH_UNCERTIFIED", catchment.Id,
                            "Water catchment lacks the required 3.15-unit cushioning depth.");
                    }
                }

                if (plan.Bounds.Minimum.Y >= catchment.StructuralBottomY - 1e-9d)
                {
                    Add(errors, "FALLBACK_PLANE_NOT_OUTSIDE_CATCHMENT", catchment.Id,
                        "Plan structural bounds do not leave a diagnostic fallback below the catchment.");
                }
            }

            foreach (IndustrialFactoryV2ValidationIssue issue in new DungeonTraversalCorpusValidatorV2().Validate(plan))
            {
                errors.Add(issue);
            }

            return Array.AsReadOnly(errors.ToArray());
        }

        private static void ValidateFailureSurfaceSweeps(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            var crumbleControllerIds = new HashSet<string>(
                plan.EnvironmentControllers
                    .Where(value => value.Kind == DungeonEnvironmentControllerKindV2.Crumble)
                    .Select(value => value.Id),
                StringComparer.Ordinal);
            foreach (DungeonSurfacePlanV2 surface in plan.Surfaces)
            {
                DungeonFallExposureCauseV2 requiredCause;
                string missingCode;
                string truncatedCode;
                if (surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
                {
                    requiredCause = DungeonFallExposureCauseV2.MovingSurfaceFailure;
                    missingCode = "MOVING_PLATFORM_SWEEP_UNCOVERED";
                    truncatedCode = "MOVING_PLATFORM_SWEEP_TRUNCATED";
                }
                else if (surface.ControllerId != null && crumbleControllerIds.Contains(surface.ControllerId))
                {
                    requiredCause = DungeonFallExposureCauseV2.Crumble;
                    missingCode = "CRUMBLE_SWEEP_UNCOVERED";
                    truncatedCode = "CRUMBLE_SWEEP_TRUNCATED";
                }
                else
                {
                    continue;
                }

                DungeonFallExposurePlanV2[] exposures = plan.FallExposures
                    .Where(value => string.Equals(value.SourceSurfaceId, surface.Id, StringComparison.Ordinal)
                        && (value.Causes & requiredCause) != 0)
                    .ToArray();
                if (exposures.Length == 0)
                {
                    Add(errors, missingCode, surface.Id,
                        "Failure-capable surface has no registered fall exposure for its complete sweep/state.");
                    continue;
                }

                if (!exposures.Any(exposure => PrismContains(exposure.SourceVolume, surface.Volume)))
                {
                    Add(errors, truncatedCode, surface.Id,
                        "Registered exposure source volume does not contain the complete authored sweep/state volume.");
                }
            }
        }

        private static bool LandingFootprintIsCovered(
            DungeonFallCatchmentPlanV2 catchment,
            IReadOnlyDictionary<string, DungeonSurfacePlanV2> surfaces,
            IReadOnlyList<DungeonPoint2V2> capsuleCatchment)
        {
            return PolygonCoveredByUnion(
                capsuleCatchment,
                BuildErodedSafeFootprints(catchment, surfaces));
        }

        private static IReadOnlyList<IReadOnlyList<DungeonPoint2V2>> BuildErodedSafeFootprints(
            DungeonFallCatchmentPlanV2 catchment,
            IReadOnlyDictionary<string, DungeonSurfacePlanV2> surfaces)
        {
            var safeFootprints = new List<IReadOnlyList<DungeonPoint2V2>>();
            foreach (string surfaceId in catchment.SafeSurfaceIds)
            {
                if (!surfaces.TryGetValue(surfaceId, out DungeonSurfacePlanV2 surface)
                    || !surface.IsWalkable
                    || surface.Kind == DungeonSurfaceKindV2.Hazard)
                {
                    continue;
                }

                IReadOnlyList<DungeonPoint2V2> eroded = ErodeConvexPolygon(
                    surface.Volume.HorizontalVertices,
                    LandingErosion);
                if (eroded.Count >= 3)
                {
                    safeFootprints.Add(eroded);
                }
            }

            return Array.AsReadOnly(safeFootprints.ToArray());
        }

        private static IReadOnlyList<DungeonPoint2V2> IntersectConvexPolygons(
            IReadOnlyList<DungeonPoint2V2> subject,
            IReadOnlyList<DungeonPoint2V2> clip)
        {
            if (subject == null || subject.Count < 3 || clip == null || clip.Count < 3)
            {
                return Array.Empty<DungeonPoint2V2>();
            }

            double signedArea = SignedAreaTwice(clip);
            if (Math.Abs(signedArea) <= GeometryEpsilon) return Array.Empty<DungeonPoint2V2>();
            double winding = Math.Sign(signedArea);
            List<DungeonPoint2V2> intersection = subject.ToList();
            for (int index = 0; index < clip.Count && intersection.Count >= 3; index += 1)
            {
                intersection = ClipHalfPlane(
                    intersection,
                    clip[index],
                    clip[(index + 1) % clip.Count],
                    winding,
                    erosion: 0d,
                    keepInside: true);
            }

            return PolygonArea(intersection) > CoverageAreaEpsilon
                ? (IReadOnlyList<DungeonPoint2V2>)Array.AsReadOnly(intersection.ToArray())
                : Array.Empty<DungeonPoint2V2>();
        }

        /// <summary>
        /// Exact, deterministic coverage proof for convex authored footprints.
        /// It repeatedly subtracts each convex cover from the remaining target
        /// pieces. Any positive-area remainder is an uncovered hole, regardless
        /// of how narrow it is or where it falls relative to a sampling grid.
        /// </summary>
        private static bool PolygonCoveredByUnion(
            IReadOnlyList<DungeonPoint2V2> target,
            IEnumerable<IReadOnlyList<DungeonPoint2V2>> covers)
        {
            var uncovered = new List<IReadOnlyList<DungeonPoint2V2>> { target };
            foreach (IReadOnlyList<DungeonPoint2V2> cover in covers)
            {
                if (cover == null || PolygonArea(cover) <= CoverageAreaEpsilon) continue;
                var next = new List<IReadOnlyList<DungeonPoint2V2>>();
                foreach (IReadOnlyList<DungeonPoint2V2> piece in uncovered)
                {
                    foreach (IReadOnlyList<DungeonPoint2V2> remainder in SubtractConvex(piece, cover))
                    {
                        if (PolygonArea(remainder) > CoverageAreaEpsilon)
                        {
                            next.Add(remainder);
                        }
                    }
                }

                uncovered = next;
                if (uncovered.Count == 0) return true;
            }

            return uncovered.Count == 0;
        }

        private static IReadOnlyList<DungeonPoint2V2> ErodeConvexPolygon(
            IReadOnlyList<DungeonPoint2V2> polygon,
            double erosion)
        {
            if (polygon == null || polygon.Count < 3) return Array.Empty<DungeonPoint2V2>();
            double signedArea = SignedAreaTwice(polygon);
            if (Math.Abs(signedArea) <= GeometryEpsilon) return Array.Empty<DungeonPoint2V2>();
            double winding = Math.Sign(signedArea);
            List<DungeonPoint2V2> eroded = polygon.ToList();
            for (int index = 0; index < polygon.Count && eroded.Count >= 3; index += 1)
            {
                eroded = ClipHalfPlane(
                    eroded,
                    polygon[index],
                    polygon[(index + 1) % polygon.Count],
                    winding,
                    erosion,
                    keepInside: true);
            }

            return PolygonArea(eroded) > CoverageAreaEpsilon
                ? (IReadOnlyList<DungeonPoint2V2>)Array.AsReadOnly(eroded.ToArray())
                : Array.Empty<DungeonPoint2V2>();
        }

        private static IEnumerable<IReadOnlyList<DungeonPoint2V2>> SubtractConvex(
            IReadOnlyList<DungeonPoint2V2> subject,
            IReadOnlyList<DungeonPoint2V2> clip)
        {
            double signedArea = SignedAreaTwice(clip);
            if (Math.Abs(signedArea) <= GeometryEpsilon)
            {
                yield return subject;
                yield break;
            }

            double winding = Math.Sign(signedArea);
            List<DungeonPoint2V2> insideRemainder = subject.ToList();
            for (int index = 0; index < clip.Count && insideRemainder.Count >= 3; index += 1)
            {
                DungeonPoint2V2 a = clip[index];
                DungeonPoint2V2 b = clip[(index + 1) % clip.Count];
                List<DungeonPoint2V2> outsidePiece = ClipHalfPlane(
                    insideRemainder,
                    a,
                    b,
                    winding,
                    erosion: 0d,
                    keepInside: false);
                if (PolygonArea(outsidePiece) > CoverageAreaEpsilon)
                {
                    yield return Array.AsReadOnly(outsidePiece.ToArray());
                }

                insideRemainder = ClipHalfPlane(
                    insideRemainder,
                    a,
                    b,
                    winding,
                    erosion: 0d,
                    keepInside: true);
            }
        }

        private static List<DungeonPoint2V2> ClipHalfPlane(
            IReadOnlyList<DungeonPoint2V2> subject,
            DungeonPoint2V2 a,
            DungeonPoint2V2 b,
            double winding,
            double erosion,
            bool keepInside)
        {
            var result = new List<DungeonPoint2V2>();
            if (subject == null || subject.Count == 0) return result;
            double edgeX = b.X - a.X;
            double edgeZ = b.Z - a.Z;
            double edgeLength = Math.Sqrt(edgeX * edgeX + edgeZ * edgeZ);
            if (edgeLength <= GeometryEpsilon) return subject.ToList();

            DungeonPoint2V2 previous = subject[subject.Count - 1];
            double previousValue = HalfPlaneValue(previous, a, edgeX, edgeZ, winding, erosion, edgeLength);
            bool previousKept = keepInside ? previousValue >= -GeometryEpsilon : previousValue <= GeometryEpsilon;
            for (int index = 0; index < subject.Count; index += 1)
            {
                DungeonPoint2V2 current = subject[index];
                double currentValue = HalfPlaneValue(current, a, edgeX, edgeZ, winding, erosion, edgeLength);
                bool currentKept = keepInside ? currentValue >= -GeometryEpsilon : currentValue <= GeometryEpsilon;
                if (currentKept != previousKept)
                {
                    double denominator = previousValue - currentValue;
                    if (Math.Abs(denominator) > 1e-15d)
                    {
                        double t = previousValue / denominator;
                        AddDistinct(result, new DungeonPoint2V2(
                            previous.X + (current.X - previous.X) * t,
                            previous.Z + (current.Z - previous.Z) * t));
                    }
                }

                if (currentKept)
                {
                    AddDistinct(result, current);
                }

                previous = current;
                previousValue = currentValue;
                previousKept = currentKept;
            }

            if (result.Count > 1 && SamePoint(result[0], result[result.Count - 1]))
            {
                result.RemoveAt(result.Count - 1);
            }

            return result;
        }

        private static double HalfPlaneValue(
            DungeonPoint2V2 point,
            DungeonPoint2V2 edgeStart,
            double edgeX,
            double edgeZ,
            double winding,
            double erosion,
            double edgeLength)
        {
            double cross = edgeX * (point.Z - edgeStart.Z) - edgeZ * (point.X - edgeStart.X);
            return winding * cross - erosion * edgeLength;
        }

        private static void AddDistinct(ICollection<DungeonPoint2V2> points, DungeonPoint2V2 point)
        {
            DungeonPoint2V2 last = points.Count == 0 ? default(DungeonPoint2V2) : points.Last();
            if (points.Count == 0 || !SamePoint(last, point)) points.Add(point);
        }

        private static bool SamePoint(DungeonPoint2V2 a, DungeonPoint2V2 b)
        {
            return Math.Abs(a.X - b.X) <= GeometryEpsilon
                && Math.Abs(a.Z - b.Z) <= GeometryEpsilon;
        }

        private static double PolygonArea(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            return Math.Abs(SignedAreaTwice(polygon)) * 0.5d;
        }

        private static double SignedAreaTwice(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            if (polygon == null || polygon.Count < 3) return 0d;
            double area = 0d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                area += a.X * b.Z - b.X * a.Z;
            }

            return area;
        }

        private static bool PrismContains(DungeonConvexPrismV2 outer, DungeonConvexPrismV2 inner)
        {
            if (outer.MinimumY > inner.MinimumY + 1e-9d
                || outer.MaximumY + 1e-9d < inner.MaximumY)
            {
                return false;
            }

            return inner.HorizontalVertices.All(point =>
                DungeonProgressionSolverV2.PointInsideConvex(
                    point.X,
                    point.Z,
                    outer.HorizontalVertices,
                    0d));
        }

        private static void Add(
            ICollection<IndustrialFactoryV2ValidationIssue> errors,
            string code,
            string id,
            string message)
        {
            errors.Add(new IndustrialFactoryV2ValidationIssue(code, "/fallCoverage/" + id, message));
        }
    }
}
