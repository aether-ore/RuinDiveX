using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    /// <summary>
    /// Release gates for the authored graph stage. These tests intentionally use
    /// the pure fixture catalog: prefab/registry conformance is covered by the
    /// Runtime Editor tests, while this suite proves that generation is not a
    /// disguised seven-room chain.
    /// </summary>
    public sealed class IndustrialFactoryV2AuthoredGenerationGateTests
    {
        private const int SeedCount = 1000;

        [Test]
        public void ThousandSeedGraphGateMeetsBudgetsPartialOrderSocketsAndSpatialVariation()
        {
            var hazards = new HashSet<DungeonBiomeDistrictKindV2>();
            var criticalBranchTopologies = new HashSet<string>(StringComparer.Ordinal);
            var beatModuleIncidenceSignatures = new HashSet<string>(StringComparer.Ordinal);
            var observedModuleCounts = new HashSet<int>();
            int miniDungeonPlanCount = 0;
            bool observedGenuineSplitBeat = false;
            bool observedManyBeatModule = false;
            bool observedBranchedGraph = false;

            for (int index = 0; index < SeedCount; index += 1)
            {
                string seed = "authored-graph-gate-" + index;
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator(
                    AcceptCandidateValidator.Instance).Generate(seed);

                Assert.That(plan.Modules.Count,
                    Is.InRange(DungeonPlanV2.MinimumModuleCount, DungeonPlanV2.MaximumModuleCount), seed);
                Assert.That(plan.Regions.Count,
                    Is.InRange(DungeonPlanV2.MinimumRegionCount, DungeonPlanV2.MaximumRegionCount), seed);
                observedModuleCounts.Add(plan.Modules.Count);

                AssertSevenBeatPartialOrder(plan, seed);
                AssertTransitionBudget(plan, seed);
                AssertMiniDungeonBudget(plan, seed);
                AssertExactSocketPairs(plan, seed);
                AssertThreeDimensionalSpan(plan, seed);

                IReadOnlyList<IndustrialFactoryV2ValidationIssue> envelopeIssues =
                    DungeonModuleEnvelopeValidatorV2.Validate(plan);
                Assert.That(envelopeIssues, Is.Empty,
                    seed + ": " + string.Join(" | ", envelopeIssues.Select(value => value.ToString())));

                hazards.Add(plan.Districts.Single(IsHazard).Kind);
                criticalBranchTopologies.Add(CriticalBranchTopology(plan));
                beatModuleIncidenceSignatures.Add(BeatModuleIncidenceSignature(plan));
                DungeonGameplayBeatPlanV2 sortingBeat = plan.GameplayBeats.Single(value =>
                    value.Kind == DungeonGameplayBeatKindV2.SortingGantry);
                observedGenuineSplitBeat |= plan.BeatAssignments.Single(value => value.BeatId == sortingBeat.Id)
                    .ModuleInstanceIds.Count > 1;
                observedManyBeatModule |= plan.Modules.Any(module => plan.BeatAssignments.Count(assignment =>
                    assignment.ModuleInstanceIds.Contains(module.Id)) > 1);
                observedBranchedGraph |= plan.AbstractRouteGraph.Nodes.Any(node =>
                    Neighbours(plan.AbstractRouteGraph, node.Id).Count() >= 3);
                if (plan.MiniDungeonCompositions.Count == 1) miniDungeonPlanCount += 1;
            }

            Assert.That(hazards, Is.EquivalentTo(new[]
            {
                DungeonBiomeDistrictKindV2.MagmaUndercroft,
                DungeonBiomeDistrictKindV2.ElectricalUndercroft
            }), "The deterministic seed corpus must exercise both Undercroft implementations.");
            Assert.That(criticalBranchTopologies.Count, Is.GreaterThanOrEqualTo(3),
                "Generation must expose at least three distinct critical/optional route graphs, not relabel one chain.");
            Assert.That(observedModuleCounts.Count, Is.GreaterThanOrEqualTo(2),
                "The authored graph should exercise more than one legal module count in the 8-14 budget.");
            Assert.That(beatModuleIncidenceSignatures.Count, Is.GreaterThanOrEqualTo(3),
                "Generation must vary beat-to-module incidence, not only rotate or reorder seven canonical slots.");
            Assert.That(observedGenuineSplitBeat, Is.True,
                "At least one deterministic graph must split Sorting Gantry across multiple authored modules.");
            Assert.That(observedManyBeatModule, Is.True,
                "At least one authored module must host multiple gameplay beats.");
            Assert.That(observedBranchedGraph, Is.True,
                "The corpus must contain a real route branch; reordered path graphs are insufficient.");
            Assert.That(miniDungeonPlanCount, Is.GreaterThan(0),
                "The seed corpus must exercise the optional 3-5-module mini-dungeon grammar.");
        }

        [Test]
        public void PrefabIndependentBlueprintContractCarriesNoSelectedDescriptorOrTransform()
        {
            string[] propertyNames = typeof(DungeonAbstractLayoutNodeV2)
                .GetProperties()
                .Select(value => value.Name)
                .ToArray();
            Assert.That(propertyNames, Does.Not.Contain("TemplateId"));
            Assert.That(propertyNames, Does.Not.Contain("Prefab"));
            Assert.That(propertyNames, Does.Not.Contain("Transform"));
            Assert.That(propertyNames, Does.Not.Contain("ConnectorIds"));

            string[] edgePropertyNames = typeof(DungeonAbstractLayoutEdgeV2)
                .GetProperties()
                .Select(value => value.Name)
                .ToArray();
            Assert.That(edgePropertyNames, Does.Contain("FromConnectorIntent"));
            Assert.That(edgePropertyNames, Does.Contain("ToConnectorIntent"));
            Assert.That(edgePropertyNames, Does.Not.Contain("FromConnectorId"));
            Assert.That(edgePropertyNames, Does.Not.Contain("ToConnectorId"));
        }

        [Test]
        public void ModuleEnvelopeOverlapRequiresCoincidentCertifiedVerticalPortals()
        {
            DungeonPlanV2 source = new IndustrialFactoryV2Generator(
                AcceptCandidateValidator.Instance).Generate("authored-overlap-contract");
            DungeonModuleInstancePlanV2 first = source.Modules[0];
            DungeonModuleInstancePlanV2 second = source.Modules[1];

            DungeonPlanV2 unregisteredOverlap = ClonePlan(
                source,
                source.Modules.Select(module => module.Id == second.Id
                    ? CloneModule(module, first.Bounds, null, Array.Empty<string>())
                    : module),
                source.Connectors);
            Assert.That(DungeonModuleEnvelopeValidatorV2.Validate(unregisteredOverlap)
                    .Select(value => value.Code),
                Does.Contain("MODULE_ENVELOPE_HORIZONTAL_OVERLAP"),
                "Copying a module onto another module's horizontal center is never a legal embedding.");

            DungeonModuleConnectorPlanV2 firstSourceConnector = source.Connectors.First(value =>
                value.ModuleInstanceId == first.Id && value.Aperture != null);
            DungeonModuleConnectorPlanV2 secondSourceConnector = source.Connectors.First(value =>
                value.ModuleInstanceId == second.Id && value.Aperture != null);
            const string compositionId = "test-certified-vertical-composition";
            const string portalId = "test-certified-vertical-portal";
            DungeonPoint3 portalPosition = firstSourceConnector.Position;

            DungeonModuleConnectorPlanV2 firstPortal = CloneVerticalPortal(
                firstSourceConnector,
                firstSourceConnector,
                portalPosition,
                new DungeonPoint3(0d, 1d, 0d),
                portalId);
            DungeonModuleConnectorPlanV2 secondPortal = CloneVerticalPortal(
                secondSourceConnector,
                firstSourceConnector,
                portalPosition,
                new DungeonPoint3(0d, -1d, 0d),
                portalId);
            DungeonPlanV2 certifiedOverlap = CloneVerticalOverlap(
                source,
                first,
                second,
                first.Bounds,
                compositionId,
                firstPortal,
                secondPortal);
            Assert.That(DungeonModuleEnvelopeValidatorV2.Validate(certifiedOverlap), Is.Empty,
                "An exact opposed portal pair in one declared vertical composition may overlap horizontally.");

            DungeonPlanV2 differentCompositionOverlap = CloneVerticalOverlap(
                source,
                first,
                second,
                first.Bounds,
                compositionId,
                firstPortal,
                secondPortal,
                "different-vertical-composition");
            Assert.That(DungeonModuleEnvelopeValidatorV2.Validate(differentCompositionOverlap)
                    .Select(value => value.Code),
                Does.Contain("MODULE_ENVELOPE_HORIZONTAL_OVERLAP"),
                "Exact portal geometry cannot authorize overlap across different vertical compositions.");

            DungeonModuleConnectorPlanV2 horizontalFirstPortal = CloneVerticalPortal(
                firstSourceConnector,
                firstSourceConnector,
                portalPosition,
                new DungeonPoint3(1d, 0d, 0d),
                portalId);
            DungeonModuleConnectorPlanV2 horizontalSecondPortal = CloneVerticalPortal(
                secondSourceConnector,
                firstSourceConnector,
                portalPosition,
                new DungeonPoint3(-1d, 0d, 0d),
                portalId);
            DungeonPlanV2 mislabeledHorizontalOverlap = CloneVerticalOverlap(
                source,
                first,
                second,
                first.Bounds,
                compositionId,
                horizontalFirstPortal,
                horizontalSecondPortal);
            Assert.That(DungeonModuleEnvelopeValidatorV2.Validate(mislabeledHorizontalOverlap)
                    .Select(value => value.Code),
                Does.Contain("MODULE_ENVELOPE_HORIZONTAL_OVERLAP"),
                "A portal label on an ordinary horizontal seam is not a certified vertical relationship.");

            DungeonModuleConnectorPlanV2 displacedSecondPortal = CloneVerticalPortal(
                secondSourceConnector,
                firstSourceConnector,
                new DungeonPoint3(portalPosition.X + 0.5d, portalPosition.Y, portalPosition.Z),
                new DungeonPoint3(0d, -1d, 0d),
                portalId);
            DungeonPlanV2 mismatchedPortalOverlap = CloneVerticalOverlap(
                source,
                first,
                second,
                first.Bounds,
                compositionId,
                firstPortal,
                displacedSecondPortal);
            Assert.That(DungeonModuleEnvelopeValidatorV2.Validate(mismatchedPortalOverlap)
                    .Select(value => value.Code),
                Does.Contain("MODULE_ENVELOPE_HORIZONTAL_OVERLAP"),
                "Sharing a portal label is insufficient when certified portal geometry does not coincide exactly.");
        }

        [Test]
        public void AbstractGraphRejectsFiveTransitionsAndAnyRunOfThree()
        {
            Assert.Throws<ArgumentException>(() => new DungeonAbstractRouteGraphV2(
                Enumerable.Range(0, 5).Select(index => new DungeonAbstractRouteNodeV2(
                    "transition-" + index,
                    DungeonBiomeDistrictKindV2.Factory,
                    transitionOnly: true)),
                Array.Empty<DungeonAbstractRouteEdgeV2>()));

            DungeonAbstractRouteNodeV2[] threeInARow =
            {
                TransitionNode("transition-a"),
                TransitionNode("transition-b"),
                TransitionNode("transition-c"),
                ChamberNode("chamber")
            };
            Assert.Throws<ArgumentException>(() => new DungeonAbstractRouteGraphV2(
                threeInARow,
                new[]
                {
                    AbstractEdge("edge-a-b", "transition-a", "transition-b"),
                    AbstractEdge("edge-b-c", "transition-b", "transition-c"),
                    AbstractEdge("edge-c-room", "transition-c", "chamber")
                }));

            Assert.DoesNotThrow(() => new DungeonAbstractRouteGraphV2(
                new[]
                {
                    TransitionNode("transition-a"),
                    TransitionNode("transition-b"),
                    ChamberNode("chamber"),
                    TransitionNode("transition-c"),
                    TransitionNode("transition-d")
                },
                new[]
                {
                    AbstractEdge("edge-a-b", "transition-a", "transition-b"),
                    AbstractEdge("edge-b-room", "transition-b", "chamber"),
                    AbstractEdge("edge-room-c", "chamber", "transition-c"),
                    AbstractEdge("edge-c-d", "transition-c", "transition-d")
                }));
        }

        private static void AssertSevenBeatPartialOrder(DungeonPlanV2 plan, string seed)
        {
            Assert.That(plan.GameplayBeats, Has.Count.EqualTo(DungeonPlanV2.RequiredGameplayBeatCount), seed);
            Assert.That(plan.GameplayBeats.Select(value => value.Kind),
                Is.EquivalentTo(Enum.GetValues(typeof(DungeonGameplayBeatKindV2))), seed);
            Assert.That(plan.BeatAssignments.Select(value => value.BeatId),
                Is.EquivalentTo(plan.GameplayBeats.Select(value => value.Id)), seed);

            var resolved = new HashSet<string>(StringComparer.Ordinal);
            bool progressed;
            do
            {
                progressed = false;
                foreach (DungeonGameplayBeatPlanV2 beat in plan.GameplayBeats)
                {
                    if (resolved.Contains(beat.Id)
                        || beat.PrerequisiteBeatIds.Any(value => !resolved.Contains(value))) continue;
                    resolved.Add(beat.Id);
                    progressed = true;
                }
            } while (progressed);
            Assert.That(resolved.Count, Is.EqualTo(DungeonPlanV2.RequiredGameplayBeatCount),
                seed + ": gameplay beat prerequisite graph must be acyclic.");

            Assert.That(TransitivelyDependsOn(
                plan,
                DungeonGameplayBeatKindV2.BrokenFreightShaft,
                DungeonGameplayBeatKindV2.NestWarehouse), Is.False, seed);
            Assert.That(TransitivelyDependsOn(
                plan,
                DungeonGameplayBeatKindV2.NestWarehouse,
                DungeonGameplayBeatKindV2.BrokenFreightShaft), Is.False,
                seed + ": Broken Freight and Nest must remain incomparable beats, proving this is a partial order rather than a fixed chain.");
            Assert.That(TransitivelyDependsOn(
                plan,
                DungeonGameplayBeatKindV2.MachineCore,
                DungeonGameplayBeatKindV2.SecurityEntrance), Is.True, seed);
        }

        private static void AssertTransitionBudget(DungeonPlanV2 plan, string seed)
        {
            IReadOnlyList<DungeonAbstractRouteNodeV2> transitions = plan.AbstractRouteGraph.Nodes
                .Where(value => value.TransitionOnly)
                .ToArray();
            Assert.That(transitions.Count, Is.LessThanOrEqualTo(4), seed);
            var nodes = plan.AbstractRouteGraph.Nodes.ToDictionary(value => value.Id, StringComparer.Ordinal);
            foreach (DungeonAbstractRouteNodeV2 first in transitions)
            {
                foreach (string secondId in Neighbours(plan.AbstractRouteGraph, first.Id))
                {
                    if (!nodes[secondId].TransitionOnly) continue;
                    bool hasThird = Neighbours(plan.AbstractRouteGraph, secondId)
                        .Any(thirdId => thirdId != first.Id && nodes[thirdId].TransitionOnly);
                    Assert.That(hasThird, Is.False,
                        seed + ": transition modules may not form a run of three.");
                }
            }
        }

        private static void AssertMiniDungeonBudget(DungeonPlanV2 plan, string seed)
        {
            Assert.That(plan.MiniDungeonCompositions.Count,
                Is.LessThanOrEqualTo(DungeonMiniDungeonCompositionGrammarV2.MaximumCompositionsPerPlan), seed);
            var moduleIds = new HashSet<string>(plan.Modules.Select(value => value.Id), StringComparer.Ordinal);
            foreach (DungeonMiniDungeonCompositionGrammarV2 composition in plan.MiniDungeonCompositions)
            {
                Assert.That(composition.ModuleInstanceIds.Count,
                    Is.InRange(
                        DungeonMiniDungeonCompositionGrammarV2.MinimumModuleCount,
                        DungeonMiniDungeonCompositionGrammarV2.MaximumModuleCount), seed);
                Assert.That(composition.ModuleInstanceIds.All(moduleIds.Contains), Is.True, seed);
                Assert.That(composition.RouteDecisionNodeIds, Has.Count.EqualTo(2), seed);
                Assert.That(composition.VerticalMechanism, Is.True, seed);
                Assert.That(composition.RewardBranchNodeId, Is.Not.Null.And.Not.Empty, seed);
                DungeonAbstractRouteEdgeV2 rejoin = plan.AbstractRouteGraph.Edges.Single(value =>
                    value.Id == composition.LoopOrRejoinEdgeId);
                Assert.That(composition.ModuleInstanceIds, Does.Contain(rejoin.FromNodeId), seed);
                Assert.That(composition.ModuleInstanceIds, Does.Contain(rejoin.ToNodeId), seed);
            }
        }

        private static void AssertExactSocketPairs(DungeonPlanV2 plan, string seed)
        {
            var connectorById = plan.Connectors.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var consumed = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 edge in plan.AbstractRouteGraph.Edges)
            {
                Assert.That(edge.FromConnectorId, Is.Not.Null.And.Not.Empty, seed + ": " + edge.Id);
                Assert.That(edge.ToConnectorId, Is.Not.Null.And.Not.Empty, seed + ": " + edge.Id);
                Assert.That(consumed.Add(edge.FromConnectorId), Is.True,
                    seed + ": connector reused by multiple abstract edges: " + edge.FromConnectorId);
                Assert.That(consumed.Add(edge.ToConnectorId), Is.True,
                    seed + ": connector reused by multiple abstract edges: " + edge.ToConnectorId);

                DungeonModuleConnectorPlanV2 from = connectorById[edge.FromConnectorId];
                DungeonModuleConnectorPlanV2 to = connectorById[edge.ToConnectorId];
                Assert.That(from.ModuleInstanceId, Is.EqualTo(edge.FromNodeId), seed + ": " + edge.Id);
                Assert.That(to.ModuleInstanceId, Is.EqualTo(edge.ToNodeId), seed + ": " + edge.Id);
                Assert.That(DungeonAbstractRouteSocketValidatorV2.IsExactPair(from, to), Is.True,
                    seed + ": " + edge.Id + " is not an exact certified aperture pair.");
            }

            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                DungeonAbstractRouteSocketValidatorV2.Validate(plan);
            Assert.That(issues, Is.Empty,
                seed + ": " + string.Join(" | ", issues.Select(value => value.ToString())));
        }

        private static void AssertThreeDimensionalSpan(DungeonPlanV2 plan, string seed)
        {
            Assert.That(plan.Regions.Select(value => value.ElevationStratum).Distinct(),
                Is.EquivalentTo(new[]
                {
                    DungeonElevationStratumV2.Lower,
                    DungeonElevationStratumV2.Entry,
                    DungeonElevationStratumV2.Upper
                }), seed);
            Assert.That(plan.Modules.Select(value => value.Transform.Translation.X).Distinct().Count(),
                Is.GreaterThan(1), seed + ": authored embedding must span X.");
            Assert.That(plan.Modules.Select(value => value.Transform.Translation.Z).Distinct().Count(),
                Is.GreaterThan(1), seed + ": authored embedding must span Z rather than returning a line of rooms.");
        }

        private static bool TransitivelyDependsOn(
            DungeonPlanV2 plan,
            DungeonGameplayBeatKindV2 beatKind,
            DungeonGameplayBeatKindV2 candidatePrerequisite)
        {
            var byId = plan.GameplayBeats.ToDictionary(value => value.Id, StringComparer.Ordinal);
            string targetId = plan.GameplayBeats.Single(value => value.Kind == candidatePrerequisite).Id;
            var pending = new Stack<string>(plan.GameplayBeats
                .Single(value => value.Kind == beatKind).PrerequisiteBeatIds);
            var visited = new HashSet<string>(StringComparer.Ordinal);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                if (!visited.Add(current)) continue;
                if (current == targetId) return true;
                foreach (string prerequisite in byId[current].PrerequisiteBeatIds) pending.Push(prerequisite);
            }
            return false;
        }

        private static IEnumerable<string> Neighbours(DungeonAbstractRouteGraphV2 graph, string nodeId)
        {
            return graph.Edges
                .Where(value => value.FromNodeId == nodeId || value.ToNodeId == nodeId)
                .Select(value => value.FromNodeId == nodeId ? value.ToNodeId : value.FromNodeId)
                .Distinct(StringComparer.Ordinal);
        }

        private static DungeonAbstractRouteNodeV2 TransitionNode(string id) =>
            new DungeonAbstractRouteNodeV2(id, DungeonBiomeDistrictKindV2.Factory, transitionOnly: true);

        private static DungeonAbstractRouteNodeV2 ChamberNode(string id) =>
            new DungeonAbstractRouteNodeV2(id, DungeonBiomeDistrictKindV2.Factory, transitionOnly: false);

        private static DungeonAbstractRouteEdgeV2 AbstractEdge(string id, string from, string to) =>
            new DungeonAbstractRouteEdgeV2(
                id,
                from,
                to,
                DungeonAbstractRouteEdgeRoleV2.DistrictTransition,
                bidirectional: true);

        private static string CriticalBranchTopology(DungeonPlanV2 plan)
        {
            return string.Join("|", plan.AbstractRouteGraph.Edges
                .Where(value => value.Role == DungeonAbstractRouteEdgeRoleV2.Critical
                    || value.Role == DungeonAbstractRouteEdgeRoleV2.Optional)
                .Select(value => LogicalNodeId(value.FromNodeId) + ">" + LogicalNodeId(value.ToNodeId)
                    + ":" + value.Role + (value.Bidirectional ? ":2" : ":1"))
                .OrderBy(value => value, StringComparer.Ordinal));
        }

        private static string BeatModuleIncidenceSignature(DungeonPlanV2 plan)
        {
            return string.Join("|", plan.BeatAssignments
                .OrderBy(value => value.BeatId, StringComparer.Ordinal)
                .Select(value => value.BeatId + "=" + string.Join(",", value.ModuleInstanceIds
                    .Select(LogicalNodeId)
                    .OrderBy(id => id, StringComparer.Ordinal))));
        }

        private static string LogicalNodeId(string moduleInstanceId)
        {
            const string prefix = "module-authored-";
            if (!moduleInstanceId.StartsWith(prefix, StringComparison.Ordinal)) return moduleInstanceId;
            string remainder = moduleInstanceId.Substring(prefix.Length);
            int separator = remainder.IndexOf('-');
            return separator < 0 ? remainder : remainder.Substring(separator + 1);
        }

        private static DungeonPlanV2 CloneVerticalOverlap(
            DungeonPlanV2 source,
            DungeonModuleInstancePlanV2 first,
            DungeonModuleInstancePlanV2 second,
            DungeonBounds3 sharedBounds,
            string compositionId,
            DungeonModuleConnectorPlanV2 firstPortal,
            DungeonModuleConnectorPlanV2 secondPortal,
            string secondCompositionId = null)
        {
            DungeonModuleInstancePlanV2[] modules = source.Modules.Select(module =>
            {
                if (module.Id == first.Id)
                    return CloneModule(module, sharedBounds, compositionId, new[] { firstPortal.Id });
                if (module.Id == second.Id)
                    return CloneModule(
                        module,
                        sharedBounds,
                        secondCompositionId ?? compositionId,
                        new[] { secondPortal.Id });
                return module;
            }).ToArray();
            DungeonModuleConnectorPlanV2[] connectors = source.Connectors.Select(connector =>
                connector.Id == firstPortal.Id
                    ? firstPortal
                    : connector.Id == secondPortal.Id
                        ? secondPortal
                        : connector).ToArray();
            return ClonePlan(source, modules, connectors);
        }

        private static DungeonModuleInstancePlanV2 CloneModule(
            DungeonModuleInstancePlanV2 source,
            DungeonBounds3 bounds,
            string verticalCompositionId,
            IEnumerable<string> verticalPortalConnectorIds)
        {
            return new DungeonModuleInstancePlanV2(
                source.Id,
                source.TemplateId,
                source.ContentHash,
                source.MacroRoleId,
                bounds,
                source.RegionIds,
                source.ConnectorIds,
                source.AnchorIds,
                source.Transform,
                source.RegionBindings,
                verticalCompositionId,
                verticalPortalConnectorIds);
        }

        private static DungeonModuleConnectorPlanV2 CloneVerticalPortal(
            DungeonModuleConnectorPlanV2 identitySource,
            DungeonModuleConnectorPlanV2 geometrySource,
            DungeonPoint3 position,
            DungeonPoint3 facing,
            string verticalPortalId)
        {
            DungeonConnectorApertureV2 source = geometrySource.Aperture;
            var aperture = new DungeonConnectorApertureV2(
                source.LocalVolume,
                source.SocketProfileId,
                source.CompatibleConnectorKinds,
                source.ThemedCapProfileId,
                source.FloorElevation,
                source.FloorSlopeDegrees,
                source.PlayerClearanceVolume,
                source.CameraClearanceVolume,
                source.SeamDepth,
                source.ApproachVolume,
                source.NavigationHandoffProfileId,
                source.CapState,
                source.MechanismBindingId,
                source.ExteriorGasketProfileId,
                verticalPortalId);
            return new DungeonModuleConnectorPlanV2(
                identitySource.Id,
                identitySource.ModuleInstanceId,
                identitySource.RegionId,
                geometrySource.Kind,
                position,
                facing,
                source.SocketProfileId,
                identitySource.AccessPredicate,
                DungeonSpatialRecordSourceV2.CertifiedModule,
                aperture);
        }

        private static DungeonPlanV2 ClonePlan(
            DungeonPlanV2 source,
            IEnumerable<DungeonModuleInstancePlanV2> modules,
            IEnumerable<DungeonModuleConnectorPlanV2> connectors)
        {
            return new DungeonPlanV2(
                source.SchemaVersion,
                source.ContractVersion,
                source.RulesetVersion,
                source.ProfileId,
                source.ContentPackVersion,
                source.Seed,
                source.AttemptSeed,
                source.GenerationAttempt,
                source.Difficulty,
                source.EntranceRegionId,
                source.ExtractionRegionId,
                source.Bounds,
                source.VoidPolicy,
                source.MacroRoles,
                modules,
                connectors,
                source.Anchors,
                source.Regions,
                source.Districts,
                source.TraversalEdges,
                source.Routes,
                source.Discoveries,
                source.Shortcuts,
                source.Surfaces,
                source.FluidZones,
                source.FluidNetworks,
                source.EnvironmentControllers,
                source.FallCatchments,
                source.FallExposures,
                source.GameplayBeats,
                source.AbstractRouteGraph,
                source.BeatAssignments,
                source.MiniDungeonCompositions);
        }

        private static bool IsHazard(DungeonBiomeDistrictPlanV2 district)
        {
            return district.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                || district.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft;
        }

        private sealed class AcceptCandidateValidator : IIndustrialFactoryV2CandidateValidator
        {
            public static readonly AcceptCandidateValidator Instance = new AcceptCandidateValidator();
            private static readonly IndustrialFactoryV2ValidationResult Accepted =
                new IndustrialFactoryV2ValidationResult(Array.Empty<IndustrialFactoryV2ValidationIssue>());

            public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan) => Accepted;
        }
    }
}
