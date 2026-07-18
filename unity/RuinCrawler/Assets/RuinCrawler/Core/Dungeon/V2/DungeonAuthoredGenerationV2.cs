using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum DungeonGameplayBeatKindV2
    {
        SecurityEntrance,
        AssemblyFloor,
        BrokenFreightShaft,
        SortingGantry,
        NestWarehouse,
        CredentialTower,
        MachineCore
    }

    public enum DungeonAbstractRouteEdgeRoleV2
    {
        Critical,
        Optional,
        Return,
        Shortcut,
        DistrictTransition
    }

    public sealed class DungeonGameplayBeatPlanV2
    {
        public DungeonGameplayBeatPlanV2(
            string id,
            DungeonGameplayBeatKindV2 kind,
            IEnumerable<string> prerequisiteBeatIds)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Kind = kind;
            PrerequisiteBeatIds = DungeonV2Contract.CopyCanonicalIds(
                prerequisiteBeatIds ?? Array.Empty<string>(),
                nameof(prerequisiteBeatIds));
        }

        public string Id { get; }
        public DungeonGameplayBeatKindV2 Kind { get; }
        public IReadOnlyList<string> PrerequisiteBeatIds { get; }
    }

    /// <summary>
    /// Semantic socket requests used by the prefab-independent route graph.
    /// They deliberately do not contain authored connector IDs. The module
    /// selection/embedding stage resolves each intent to an exact connector
    /// carried by the selected baked descriptor.
    /// </summary>
    public enum DungeonAbstractConnectorIntentV2
    {
        Entry,
        Forward,
        Branch,
        LowerEntry,
        LowerForward,
        LowerBranch
    }

    /// <summary>
    /// A gameplay-space requirement in the abstract route graph. This is not a
    /// prefab slot: a beat may own several nodes and a node may satisfy several
    /// beats. Archetypes are semantic constraints evaluated later against the
    /// injected baked-descriptor catalog.
    /// </summary>
    public sealed class DungeonAbstractLayoutNodeV2
    {
        public DungeonAbstractLayoutNodeV2(
            string id,
            DungeonMacroRoleKindV2 ownershipRole,
            DungeonBiomeDistrictKindV2 district,
            IEnumerable<string> gameplayBeatIds,
            IEnumerable<DungeonModuleArchetypeV2> compatibleArchetypes,
            string primaryRegionId,
            string secondaryRegionId,
            bool transitionOnly)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            OwnershipRole = ownershipRole;
            District = district;
            GameplayBeatIds = DungeonV2Contract.CopyCanonicalIds(
                gameplayBeatIds,
                nameof(gameplayBeatIds),
                minimumCount: 1);
            CompatibleArchetypes = Array.AsReadOnly((compatibleArchetypes
                    ?? throw new ArgumentNullException(nameof(compatibleArchetypes)))
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray());
            if (CompatibleArchetypes.Count == 0)
                throw new ArgumentException("Abstract layout nodes require at least one compatible archetype.", nameof(compatibleArchetypes));
            PrimaryRegionId = DungeonV2Contract.RequireId(primaryRegionId, nameof(primaryRegionId));
            SecondaryRegionId = DungeonV2Contract.RequireId(secondaryRegionId, nameof(secondaryRegionId));
            if (string.Equals(PrimaryRegionId, SecondaryRegionId, StringComparison.Ordinal))
                throw new ArgumentException("Abstract layout region identities must be distinct.", nameof(secondaryRegionId));
            TransitionOnly = transitionOnly;
        }

        public string Id { get; }
        public DungeonMacroRoleKindV2 OwnershipRole { get; }
        public DungeonBiomeDistrictKindV2 District { get; }
        public IReadOnlyList<string> GameplayBeatIds { get; }
        public IReadOnlyList<DungeonModuleArchetypeV2> CompatibleArchetypes { get; }
        public string PrimaryRegionId { get; }
        public string SecondaryRegionId { get; }
        public bool TransitionOnly { get; }
    }

    public sealed class DungeonAbstractLayoutEdgeV2
    {
        public DungeonAbstractLayoutEdgeV2(
            string id,
            string fromNodeId,
            DungeonAbstractConnectorIntentV2 fromConnectorIntent,
            string toNodeId,
            DungeonAbstractConnectorIntentV2 toConnectorIntent,
            DungeonAbstractRouteEdgeRoleV2 role,
            bool bidirectional,
            bool placementEdge)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            FromNodeId = DungeonV2Contract.RequireId(fromNodeId, nameof(fromNodeId));
            ToNodeId = DungeonV2Contract.RequireId(toNodeId, nameof(toNodeId));
            if (string.Equals(FromNodeId, ToNodeId, StringComparison.Ordinal))
                throw new ArgumentException("Abstract layout edges may not self-loop.");
            FromConnectorIntent = fromConnectorIntent;
            ToConnectorIntent = toConnectorIntent;
            Role = role;
            Bidirectional = bidirectional;
            PlacementEdge = placementEdge;
        }

        public string Id { get; }
        public string FromNodeId { get; }
        public string ToNodeId { get; }
        public DungeonAbstractConnectorIntentV2 FromConnectorIntent { get; }
        public DungeonAbstractConnectorIntentV2 ToConnectorIntent { get; }
        public DungeonAbstractRouteEdgeRoleV2 Role { get; }
        public bool Bidirectional { get; }
        public bool PlacementEdge { get; }
    }

    /// <summary>
    /// Pure graph produced from gameplay beats before a module catalog is
    /// consulted. Placement edges form only the constructive spanning tree;
    /// all other edges remain route requirements whose exact sockets must also
    /// coincide after embedding.
    /// </summary>
    public sealed class DungeonAbstractLayoutBlueprintV2
    {
        public DungeonAbstractLayoutBlueprintV2(
            IEnumerable<DungeonGameplayBeatPlanV2> gameplayBeats,
            IEnumerable<DungeonAbstractLayoutNodeV2> nodes,
            IEnumerable<DungeonAbstractLayoutEdgeV2> edges,
            string entryNodeId)
        {
            GameplayBeats = DungeonV2Contract.CopyCanonical(
                gameplayBeats,
                value => value.Id,
                nameof(gameplayBeats),
                DungeonPlanV2.RequiredGameplayBeatCount);
            if (GameplayBeats.Count != DungeonPlanV2.RequiredGameplayBeatCount
                || GameplayBeats.Select(value => value.Kind).Distinct().Count() != DungeonPlanV2.RequiredGameplayBeatCount)
                throw new ArgumentException("An authored V2 blueprint requires all seven unique gameplay beats.", nameof(gameplayBeats));

            Nodes = DungeonV2Contract.CopyCanonical(
                nodes,
                value => value.Id,
                nameof(nodes),
                DungeonPlanV2.MinimumModuleCount);
            if (Nodes.Count > DungeonPlanV2.MaximumModuleCount)
                throw new ArgumentException("An authored V2 blueprint may contain at most fourteen module requirements.", nameof(nodes));
            Edges = DungeonV2Contract.CopyCanonical(edges, value => value.Id, nameof(edges), minimumCount: 1);
            EntryNodeId = DungeonV2Contract.RequireId(entryNodeId, nameof(entryNodeId));

            ValidateReferencesAndBeatCoverage();
            ValidateConstructiveTree();
            ValidateTransitionBudget();
        }

        public IReadOnlyList<DungeonGameplayBeatPlanV2> GameplayBeats { get; }
        public IReadOnlyList<DungeonAbstractLayoutNodeV2> Nodes { get; }
        public IReadOnlyList<DungeonAbstractLayoutEdgeV2> Edges { get; }
        public string EntryNodeId { get; }

        private void ValidateReferencesAndBeatCoverage()
        {
            var beatIds = new HashSet<string>(GameplayBeats.Select(value => value.Id), StringComparer.Ordinal);
            var nodeIds = new HashSet<string>(Nodes.Select(value => value.Id), StringComparer.Ordinal);
            if (!nodeIds.Contains(EntryNodeId))
                throw new ArgumentException("The blueprint entry node is missing.", nameof(EntryNodeId));
            foreach (DungeonAbstractLayoutNodeV2 node in Nodes)
            foreach (string beatId in node.GameplayBeatIds)
            {
                if (!beatIds.Contains(beatId))
                    throw new ArgumentException("Abstract layout node references an unknown gameplay beat.", nameof(Nodes));
            }
            foreach (string beatId in beatIds)
            {
                if (!Nodes.Any(value => value.GameplayBeatIds.Contains(beatId)))
                    throw new ArgumentException("Every required gameplay beat must participate in at least one abstract node.", nameof(Nodes));
            }
            foreach (DungeonAbstractLayoutEdgeV2 edge in Edges)
            {
                if (!nodeIds.Contains(edge.FromNodeId) || !nodeIds.Contains(edge.ToNodeId))
                    throw new ArgumentException("Abstract layout edge references an unknown node.", nameof(Edges));
            }
        }

        private void ValidateConstructiveTree()
        {
            DungeonAbstractLayoutEdgeV2[] placement = Edges.Where(value => value.PlacementEdge).ToArray();
            foreach (DungeonAbstractLayoutNodeV2 node in Nodes)
            {
                int incoming = placement.Count(value => string.Equals(value.ToNodeId, node.Id, StringComparison.Ordinal));
                int expected = string.Equals(node.Id, EntryNodeId, StringComparison.Ordinal) ? 0 : 1;
                if (incoming != expected)
                    throw new ArgumentException("Every non-entry abstract node requires exactly one constructive placement parent.", nameof(Edges));
            }

            var reached = new HashSet<string>(StringComparer.Ordinal) { EntryNodeId };
            bool progressed;
            do
            {
                progressed = false;
                foreach (DungeonAbstractLayoutEdgeV2 edge in placement)
                {
                    if (!reached.Contains(edge.FromNodeId) || reached.Contains(edge.ToNodeId)) continue;
                    reached.Add(edge.ToNodeId);
                    progressed = true;
                }
            } while (progressed);
            if (reached.Count != Nodes.Count)
                throw new ArgumentException("Constructive placement edges must form an acyclic tree rooted at the entry.", nameof(Edges));
        }

        private void ValidateTransitionBudget()
        {
            if (Nodes.Count(value => value.TransitionOnly) > 4)
                throw new ArgumentException("A V2 blueprint may contain at most four transition modules.", nameof(Nodes));
            var byId = Nodes.ToDictionary(value => value.Id, StringComparer.Ordinal);
            foreach (DungeonAbstractLayoutNodeV2 first in Nodes.Where(value => value.TransitionOnly))
            {
                foreach (string secondId in Neighbours(first.Id))
                {
                    if (!byId[secondId].TransitionOnly) continue;
                    if (Neighbours(secondId).Any(thirdId => thirdId != first.Id && byId[thirdId].TransitionOnly))
                        throw new ArgumentException("A V2 blueprint may not contain three consecutive transition modules.", nameof(Nodes));
                }
            }
        }

        private IEnumerable<string> Neighbours(string nodeId) => Edges
            .Where(value => value.FromNodeId == nodeId || value.ToNodeId == nodeId)
            .Select(value => value.FromNodeId == nodeId ? value.ToNodeId : value.FromNodeId)
            .Distinct(StringComparer.Ordinal);
    }

    public sealed class DungeonAbstractRouteNodeV2
    {
        public DungeonAbstractRouteNodeV2(
            string id,
            DungeonBiomeDistrictKindV2 district,
            bool transitionOnly)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            District = district;
            TransitionOnly = transitionOnly;
        }

        public string Id { get; }
        public DungeonBiomeDistrictKindV2 District { get; }
        public bool TransitionOnly { get; }
    }

    public sealed class DungeonAbstractRouteEdgeV2
    {
        public DungeonAbstractRouteEdgeV2(
            string id,
            string fromNodeId,
            string toNodeId,
            DungeonAbstractRouteEdgeRoleV2 role,
            bool bidirectional)
            : this(id, fromNodeId, toNodeId, role, bidirectional, null, null)
        {
        }

        public DungeonAbstractRouteEdgeV2(
            string id,
            string fromNodeId,
            string toNodeId,
            DungeonAbstractRouteEdgeRoleV2 role,
            bool bidirectional,
            string fromConnectorId,
            string toConnectorId)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            FromNodeId = DungeonV2Contract.RequireId(fromNodeId, nameof(fromNodeId));
            ToNodeId = DungeonV2Contract.RequireId(toNodeId, nameof(toNodeId));
            if (string.Equals(FromNodeId, ToNodeId, StringComparison.Ordinal))
                throw new ArgumentException("Abstract route edges may not self-loop.");
            Role = role;
            Bidirectional = bidirectional;
            FromConnectorId = DungeonV2Contract.OptionalId(fromConnectorId, nameof(fromConnectorId));
            ToConnectorId = DungeonV2Contract.OptionalId(toConnectorId, nameof(toConnectorId));
            if ((FromConnectorId == null) != (ToConnectorId == null))
                throw new ArgumentException("Abstract route connector pairs must be supplied together.");
        }

        public string Id { get; }
        public string FromNodeId { get; }
        public string ToNodeId { get; }
        public DungeonAbstractRouteEdgeRoleV2 Role { get; }
        public bool Bidirectional { get; }
        public string FromConnectorId { get; }
        public string ToConnectorId { get; }
    }

    public sealed class DungeonAbstractRouteGraphV2
    {
        public DungeonAbstractRouteGraphV2(
            IEnumerable<DungeonAbstractRouteNodeV2> nodes,
            IEnumerable<DungeonAbstractRouteEdgeV2> edges)
        {
            Nodes = DungeonV2Contract.CopyCanonical(nodes, value => value.Id, nameof(nodes), minimumCount: 1);
            Edges = DungeonV2Contract.CopyCanonical(edges, value => value.Id, nameof(edges));
            var nodeIds = new HashSet<string>(Nodes.Select(value => value.Id), StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 edge in Edges)
            {
                if (!nodeIds.Contains(edge.FromNodeId) || !nodeIds.Contains(edge.ToNodeId))
                    throw new ArgumentException("Abstract route edge references an unknown node.", nameof(edges));
            }
            ValidateTransitionBudget();
        }

        public IReadOnlyList<DungeonAbstractRouteNodeV2> Nodes { get; }
        public IReadOnlyList<DungeonAbstractRouteEdgeV2> Edges { get; }

        private void ValidateTransitionBudget()
        {
            int transitions = Nodes.Count(value => value.TransitionOnly);
            if (transitions > 4)
                throw new ArgumentException("A V2 route graph may contain at most four transition-only modules.");
            foreach (DungeonAbstractRouteNodeV2 node in Nodes.Where(value => value.TransitionOnly))
            {
                IEnumerable<string> neighbours = Edges
                    .Where(value => value.FromNodeId == node.Id || value.ToNodeId == node.Id)
                    .Select(value => value.FromNodeId == node.Id ? value.ToNodeId : value.FromNodeId);
                foreach (string neighbour in neighbours)
                {
                    DungeonAbstractRouteNodeV2 adjacent = Nodes.Single(value => value.Id == neighbour);
                    if (!adjacent.TransitionOnly) continue;
                    bool third = Edges
                        .Where(value => value.FromNodeId == adjacent.Id || value.ToNodeId == adjacent.Id)
                        .Select(value => value.FromNodeId == adjacent.Id ? value.ToNodeId : value.FromNodeId)
                        .Any(next => next != node.Id && Nodes.Single(value => value.Id == next).TransitionOnly);
                    if (third)
                        throw new ArgumentException("A route graph may not contain three consecutive transition modules.");
                }
            }
        }
    }

    public sealed class DungeonGameplayBeatAssignmentV2
    {
        public DungeonGameplayBeatAssignmentV2(string beatId, IEnumerable<string> moduleInstanceIds)
        {
            BeatId = DungeonV2Contract.RequireId(beatId, nameof(beatId));
            ModuleInstanceIds = DungeonV2Contract.CopyCanonicalIds(
                moduleInstanceIds,
                nameof(moduleInstanceIds),
                minimumCount: 1);
        }

        public string BeatId { get; }
        public IReadOnlyList<string> ModuleInstanceIds { get; }
    }

    /// <summary>
    public enum DungeonMiniDungeonMechanismKindV2
    {
        VerticalLift = 0,
        VerticalWaterRouting = 1,
        VerticalHazardReturn = 2
    }

    /// Mini-dungeons are graph compositions, never a monolithic archetype.
    /// A plan may include at most one composition containing 3-5 authored
    /// modules, exactly two route decisions, an explicitly vertical mechanism,
    /// a reward branch, and a certified loop-or-rejoin graph edge.
    /// </summary>
    public sealed class DungeonMiniDungeonCompositionGrammarV2
    {
        public const int MinimumModuleCount = 3;
        public const int MaximumModuleCount = 5;
        public const int MaximumCompositionsPerPlan = 1;

        public DungeonMiniDungeonCompositionGrammarV2(
            string id,
            IEnumerable<string> moduleInstanceIds,
            IEnumerable<string> routeDecisionNodeIds,
            string entryNodeId,
            string criticalExitNodeId,
            string mechanismTargetId,
            DungeonMiniDungeonMechanismKindV2 mechanismKind,
            bool verticalMechanism,
            string rewardBranchNodeId,
            string loopOrRejoinEdgeId)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            ModuleInstanceIds = DungeonV2Contract.CopyCanonicalIds(
                moduleInstanceIds,
                nameof(moduleInstanceIds),
                MinimumModuleCount);
            if (ModuleInstanceIds.Count > MaximumModuleCount)
                throw new ArgumentException("Mini-dungeon compositions may use at most five modules.", nameof(moduleInstanceIds));
            RouteDecisionNodeIds = DungeonV2Contract.CopyCanonicalIds(
                routeDecisionNodeIds,
                nameof(routeDecisionNodeIds),
                minimumCount: 2);
            if (RouteDecisionNodeIds.Count != 2)
                throw new ArgumentException("Mini-dungeon compositions require exactly two route decisions.", nameof(routeDecisionNodeIds));
            EntryNodeId = DungeonV2Contract.RequireId(entryNodeId, nameof(entryNodeId));
            CriticalExitNodeId = DungeonV2Contract.RequireId(criticalExitNodeId, nameof(criticalExitNodeId));
            if (string.Equals(EntryNodeId, CriticalExitNodeId, StringComparison.Ordinal))
                throw new ArgumentException("Mini-dungeon entry and critical exit nodes must be distinct.", nameof(criticalExitNodeId));
            MechanismTargetId = DungeonV2Contract.RequireId(mechanismTargetId, nameof(mechanismTargetId));
            MechanismKind = mechanismKind;
            VerticalMechanism = verticalMechanism;
            if (!VerticalMechanism)
                throw new ArgumentException("Mini-dungeon mechanisms must change traversal elevation.", nameof(verticalMechanism));
            RewardBranchNodeId = DungeonV2Contract.RequireId(rewardBranchNodeId, nameof(rewardBranchNodeId));
            LoopOrRejoinEdgeId = DungeonV2Contract.RequireId(loopOrRejoinEdgeId, nameof(loopOrRejoinEdgeId));

            var moduleSet = new HashSet<string>(ModuleInstanceIds, StringComparer.Ordinal);
            if (!moduleSet.Contains(EntryNodeId)
                || !moduleSet.Contains(CriticalExitNodeId)
                || !moduleSet.Contains(RewardBranchNodeId)
                || RouteDecisionNodeIds.Any(value => !moduleSet.Contains(value)))
                throw new ArgumentException("Mini-dungeon route nodes must belong to its authored module set.");
        }

        public string Id { get; }
        public IReadOnlyList<string> ModuleInstanceIds { get; }
        public IReadOnlyList<string> RouteDecisionNodeIds { get; }
        public string EntryNodeId { get; }
        public string CriticalExitNodeId { get; }
        public string MechanismTargetId { get; }
        public DungeonMiniDungeonMechanismKindV2 MechanismKind { get; }
        public bool VerticalMechanism { get; }
        public string RewardBranchNodeId { get; }
        public string LoopOrRejoinEdgeId { get; }
    }

    public static class DungeonSocketPlacementSolverV2
    {
        public const double SeamTolerance = 1e-9d;

        public static bool TryAlign(
            CertifiedDungeonConnectorGeometryV2 localConnector,
            DungeonModuleConnectorPlanV2 placedConnector,
            out DungeonModuleTransformV2 transform)
        {
            if (localConnector == null) throw new ArgumentNullException(nameof(localConnector));
            if (placedConnector == null) throw new ArgumentNullException(nameof(placedConnector));
            transform = DungeonModuleTransformV2.Identity;
            if (placedConnector.Aperture == null) return false;
            if (!ProfilesCompatible(localConnector, placedConnector)) return false;

            for (int turns = 0; turns < 4; turns += 1)
            {
                var rotation = new DungeonModuleTransformV2(DungeonPoint3.Zero, turns);
                DungeonPoint3 facing = rotation.TransformDirection(localConnector.Facing);
                if (!Opposed(facing, placedConnector.Facing)) continue;
                DungeonPoint3 rotatedPosition = rotation.TransformPoint(localConnector.Position);
                var translation = new DungeonPoint3(
                    placedConnector.Position.X - rotatedPosition.X,
                    placedConnector.Position.Y - rotatedPosition.Y,
                    placedConnector.Position.Z - rotatedPosition.Z);
                var candidate = new DungeonModuleTransformV2(translation, turns);
                double localFloor = localConnector.Aperture.FloorElevation + translation.Y;
                if (Math.Abs(localFloor - placedConnector.Aperture.FloorElevation) > SeamTolerance)
                    continue;
                transform = candidate;
                return true;
            }
            return false;
        }

        public static bool ProfilesCompatible(
            CertifiedDungeonConnectorGeometryV2 local,
            DungeonModuleConnectorPlanV2 placed)
        {
            return local.Aperture.Accepts(placed.Kind, placed.SocketTag)
                && placed.Aperture.Accepts(local.Kind, local.SocketTag)
                && Math.Abs(local.Aperture.FloorSlopeDegrees - placed.Aperture.FloorSlopeDegrees) <= SeamTolerance
                && string.Equals(
                    local.Aperture.NavigationHandoffProfileId,
                    placed.Aperture.NavigationHandoffProfileId,
                    StringComparison.Ordinal)
                && string.Equals(
                    local.Aperture.ExteriorGasketProfileId,
                    placed.Aperture.ExteriorGasketProfileId,
                    StringComparison.Ordinal);
        }

        private static bool Opposed(DungeonPoint3 left, DungeonPoint3 right)
        {
            return Math.Abs(left.X + right.X) <= SeamTolerance
                && Math.Abs(left.Y + right.Y) <= SeamTolerance
                && Math.Abs(left.Z + right.Z) <= SeamTolerance;
        }
    }

    public static class DungeonModuleEnvelopeValidatorV2
    {
        public static IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var issues = new List<IndustrialFactoryV2ValidationIssue>();
            for (int leftIndex = 0; leftIndex < plan.Modules.Count; leftIndex += 1)
            for (int rightIndex = leftIndex + 1; rightIndex < plan.Modules.Count; rightIndex += 1)
            {
                DungeonModuleInstancePlanV2 left = plan.Modules[leftIndex];
                DungeonModuleInstancePlanV2 right = plan.Modules[rightIndex];
                if (!HorizontalOverlap(left.Bounds, right.Bounds)) continue;
                if (CertifiedVerticalRelationship(plan, left, right)) continue;
                issues.Add(new IndustrialFactoryV2ValidationIssue(
                    "MODULE_ENVELOPE_HORIZONTAL_OVERLAP",
                    "/modules/" + left.Id + "+" + right.Id,
                    "Independently selected module envelopes overlap without a shared VerticalCompositionId and certified portal."));
            }
            return Array.AsReadOnly(issues.ToArray());
        }

        private static bool CertifiedVerticalRelationship(
            DungeonPlanV2 plan,
            DungeonModuleInstancePlanV2 left,
            DungeonModuleInstancePlanV2 right)
        {
            if (left.VerticalCompositionId == null
                || !string.Equals(left.VerticalCompositionId, right.VerticalCompositionId, StringComparison.Ordinal))
                return false;

            foreach (string leftConnectorId in left.VerticalPortalConnectorIds)
            {
                DungeonModuleConnectorPlanV2 leftConnector = plan.Connectors.SingleOrDefault(value =>
                    string.Equals(value.Id, leftConnectorId, StringComparison.Ordinal)
                    && string.Equals(value.ModuleInstanceId, left.Id, StringComparison.Ordinal));
                if (!IsVerticalPortal(leftConnector)) continue;

                foreach (string rightConnectorId in right.VerticalPortalConnectorIds)
                {
                    DungeonModuleConnectorPlanV2 rightConnector = plan.Connectors.SingleOrDefault(value =>
                        string.Equals(value.Id, rightConnectorId, StringComparison.Ordinal)
                        && string.Equals(value.ModuleInstanceId, right.Id, StringComparison.Ordinal));
                    if (!IsVerticalPortal(rightConnector)
                        || !string.Equals(
                            leftConnector.Aperture.VerticalCompositionPortalId,
                            rightConnector.Aperture.VerticalCompositionPortalId,
                            StringComparison.Ordinal)
                        || !leftConnector.Aperture.Accepts(rightConnector.Kind, rightConnector.SocketTag)
                        || !rightConnector.Aperture.Accepts(leftConnector.Kind, leftConnector.SocketTag))
                    {
                        continue;
                    }

                    if (DungeonAbstractRouteSocketValidatorV2.IsExactPair(leftConnector, rightConnector))
                        return true;
                }
            }

            return false;
        }

        private static bool IsVerticalPortal(DungeonModuleConnectorPlanV2 connector)
        {
            if (connector?.Aperture?.VerticalCompositionPortalId == null) return false;
            const double tolerance = DungeonSocketPlacementSolverV2.SeamTolerance;
            return Math.Abs(connector.Facing.X) <= tolerance
                && Math.Abs(connector.Facing.Z) <= tolerance
                && Math.Abs(Math.Abs(connector.Facing.Y) - 1d) <= tolerance;
        }

        private static bool HorizontalOverlap(DungeonBounds3 left, DungeonBounds3 right)
        {
            const double tolerance = 1e-9d;
            return left.Minimum.X < right.Maximum.X - tolerance
                && left.Maximum.X > right.Minimum.X + tolerance
                && left.Minimum.Z < right.Maximum.Z - tolerance
                && left.Maximum.Z > right.Minimum.Z + tolerance;
        }
    }

    public static class DungeonAbstractRouteSocketValidatorV2
    {
        public static IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var issues = new List<IndustrialFactoryV2ValidationIssue>();
            var connectorUse = new Dictionary<string, string>(StringComparer.Ordinal);
            var declaredPairs = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 edge in plan.AbstractRouteGraph.Edges)
            {
                string path = "/abstractRouteGraph/edges/" + edge.Id;
                if (edge.FromConnectorId == null || edge.ToConnectorId == null)
                {
                    issues.Add(new IndustrialFactoryV2ValidationIssue(
                        "ABSTRACT_ROUTE_SOCKET_PAIR_REQUIRED",
                        path,
                        "Every inter-module route edge must reference an exact certified connector pair."));
                    continue;
                }

                DungeonModuleConnectorPlanV2 from = plan.Connectors.SingleOrDefault(value => value.Id == edge.FromConnectorId);
                DungeonModuleConnectorPlanV2 to = plan.Connectors.SingleOrDefault(value => value.Id == edge.ToConnectorId);
                if (from == null || to == null)
                {
                    issues.Add(new IndustrialFactoryV2ValidationIssue(
                        "ABSTRACT_ROUTE_SOCKET_UNKNOWN",
                        path,
                        "The route edge references a connector absent from the placed plan."));
                    continue;
                }
                if (!string.Equals(from.ModuleInstanceId, edge.FromNodeId, StringComparison.Ordinal)
                    || !string.Equals(to.ModuleInstanceId, edge.ToNodeId, StringComparison.Ordinal))
                {
                    issues.Add(new IndustrialFactoryV2ValidationIssue(
                        "ABSTRACT_ROUTE_SOCKET_OWNERSHIP",
                        path,
                        "The connector pair must be owned by its corresponding abstract route nodes."));
                    continue;
                }
                if (from.Source != DungeonSpatialRecordSourceV2.CertifiedModule
                    || to.Source != DungeonSpatialRecordSourceV2.CertifiedModule)
                {
                    issues.Add(new IndustrialFactoryV2ValidationIssue(
                        "ABSTRACT_ROUTE_SOCKET_SOURCE",
                        path,
                        "Abstract route edges may open only exact connectors baked from authored modules."));
                    continue;
                }
                RegisterConnectorUse(edge.FromConnectorId, edge.Id, path, connectorUse, issues);
                RegisterConnectorUse(edge.ToConnectorId, edge.Id, path, connectorUse, issues);
                if (!IsExactPair(from, to))
                {
                    issues.Add(new IndustrialFactoryV2ValidationIssue(
                        "ABSTRACT_ROUTE_SOCKET_MISMATCH",
                        path,
                        "Connector positions, facings, aperture geometry, floor, clearance, or socket profiles do not form an exact seam."));
                    continue;
                }

                declaredPairs.Add(PairKey(edge.FromConnectorId, edge.ToConnectorId));
            }

            DungeonModuleConnectorPlanV2[] connectors = plan.Connectors
                .Where(value => value.Source == DungeonSpatialRecordSourceV2.CertifiedModule)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            for (int leftIndex = 0; leftIndex < connectors.Length; leftIndex += 1)
            for (int rightIndex = leftIndex + 1; rightIndex < connectors.Length; rightIndex += 1)
            {
                DungeonModuleConnectorPlanV2 left = connectors[leftIndex];
                DungeonModuleConnectorPlanV2 right = connectors[rightIndex];
                if (string.Equals(left.ModuleInstanceId, right.ModuleInstanceId, StringComparison.Ordinal)
                    || !IsExactPair(left, right)
                    || declaredPairs.Contains(PairKey(left.Id, right.Id)))
                {
                    continue;
                }

                issues.Add(new IndustrialFactoryV2ValidationIssue(
                    "ABSTRACT_ROUTE_SOCKET_UNDECLARED_SEAM",
                    "/connectors/" + left.Id + "+" + right.Id,
                    "Two certified connectors form an exact coincident seam, but no abstract route edge declares that exact pair."));
            }
            return Array.AsReadOnly(issues.ToArray());
        }

        /// <summary>
        /// The single Core predicate for deciding whether two placed connector
        /// payloads form the same certified seam. Runtime cap binding uses this
        /// together with the explicit abstract-route edge; coincidence alone
        /// never authorizes an opening.
        /// </summary>
        public static bool IsExactPair(
            DungeonModuleConnectorPlanV2 from,
            DungeonModuleConnectorPlanV2 to)
        {
            if (from == null || to == null) return false;
            const double tolerance = DungeonSocketPlacementSolverV2.SeamTolerance;
            if (from.Aperture == null || to.Aperture == null) return false;
            if (Math.Abs(from.Position.X - to.Position.X) > tolerance
                || Math.Abs(from.Position.Y - to.Position.Y) > tolerance
                || Math.Abs(from.Position.Z - to.Position.Z) > tolerance
                || Math.Abs(from.Facing.X + to.Facing.X) > tolerance
                || Math.Abs(from.Facing.Y + to.Facing.Y) > tolerance
                || Math.Abs(from.Facing.Z + to.Facing.Z) > tolerance)
                return false;
            if (!string.Equals(from.Aperture.SocketProfileId, to.Aperture.SocketProfileId, StringComparison.Ordinal)
                || !string.Equals(from.Aperture.NavigationHandoffProfileId, to.Aperture.NavigationHandoffProfileId, StringComparison.Ordinal)
                || !string.Equals(from.Aperture.ExteriorGasketProfileId, to.Aperture.ExteriorGasketProfileId, StringComparison.Ordinal)
                || Math.Abs(from.Aperture.FloorElevation - to.Aperture.FloorElevation) > tolerance
                || Math.Abs(from.Aperture.FloorSlopeDegrees - to.Aperture.FloorSlopeDegrees) > tolerance
                || Math.Abs(from.Aperture.SeamDepth - to.Aperture.SeamDepth) > tolerance)
                return false;
            return DungeonCertifiedModulePlacementV2.PrismEqual(
                    from.Aperture.LocalVolume,
                    to.Aperture.LocalVolume,
                    tolerance)
                && DungeonCertifiedModulePlacementV2.PrismEqual(
                    from.Aperture.PlayerClearanceVolume,
                    to.Aperture.PlayerClearanceVolume,
                    tolerance)
                && DungeonCertifiedModulePlacementV2.PrismEqual(
                    from.Aperture.CameraClearanceVolume,
                    to.Aperture.CameraClearanceVolume,
                    tolerance)
                && DungeonCertifiedModulePlacementV2.PrismEqual(
                    from.Aperture.ApproachVolume,
                    to.Aperture.ApproachVolume,
                    tolerance);
        }

        private static void RegisterConnectorUse(
            string connectorId,
            string edgeId,
            string path,
            IDictionary<string, string> connectorUse,
            ICollection<IndustrialFactoryV2ValidationIssue> issues)
        {
            if (connectorUse.TryGetValue(connectorId, out string firstEdgeId))
            {
                issues.Add(new IndustrialFactoryV2ValidationIssue(
                    "ABSTRACT_ROUTE_SOCKET_REUSED",
                    path,
                    "Connector '" + connectorId + "' is already consumed by abstract route edge '"
                        + firstEdgeId + "' and cannot also serve edge '" + edgeId + "'."));
                return;
            }

            connectorUse.Add(connectorId, edgeId);
        }

        private static string PairKey(string leftId, string rightId)
        {
            return string.CompareOrdinal(leftId, rightId) <= 0
                ? leftId + "\n" + rightId
                : rightId + "\n" + leftId;
        }
    }
}
