using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Pure authored-layout stage used before plan assembly. The immutable
    /// abstract blueprint is produced before the injected descriptor catalog is
    /// consulted. The selected baked descriptors are then embedded through
    /// exact socket geometry and materialized into the plan-facing route graph.
    /// </summary>
    internal sealed class IndustrialFactoryV2AuthoredLayout
    {
        public IndustrialFactoryV2AuthoredLayout(
            IEnumerable<IndustrialFactoryV2AuthoredModuleDraft> modules,
            DungeonAbstractLayoutBlueprintV2 blueprint,
            DungeonAbstractRouteGraphV2 abstractRouteGraph,
            IEnumerable<DungeonGameplayBeatAssignmentV2> beatAssignments,
            IEnumerable<DungeonMiniDungeonCompositionGrammarV2> miniDungeonCompositions,
            int backtrackCount)
        {
            Modules = Array.AsReadOnly((modules ?? throw new ArgumentNullException(nameof(modules))).ToArray());
            Blueprint = blueprint ?? throw new ArgumentNullException(nameof(blueprint));
            GameplayBeats = Blueprint.GameplayBeats;
            AbstractRouteGraph = abstractRouteGraph ?? throw new ArgumentNullException(nameof(abstractRouteGraph));
            BeatAssignments = Array.AsReadOnly((beatAssignments ?? throw new ArgumentNullException(nameof(beatAssignments))).ToArray());
            MiniDungeonCompositions = Array.AsReadOnly((miniDungeonCompositions
                ?? throw new ArgumentNullException(nameof(miniDungeonCompositions))).ToArray());
            BacktrackCount = backtrackCount;
        }

        public IReadOnlyList<IndustrialFactoryV2AuthoredModuleDraft> Modules { get; }
        public DungeonAbstractLayoutBlueprintV2 Blueprint { get; }
        public IReadOnlyList<DungeonGameplayBeatPlanV2> GameplayBeats { get; }
        public DungeonAbstractRouteGraphV2 AbstractRouteGraph { get; }
        public IReadOnlyList<DungeonGameplayBeatAssignmentV2> BeatAssignments { get; }
        public IReadOnlyList<DungeonMiniDungeonCompositionGrammarV2> MiniDungeonCompositions { get; }
        public int BacktrackCount { get; }
    }

    internal sealed class IndustrialFactoryV2AuthoredModuleDraft
    {
        public IndustrialFactoryV2AuthoredModuleDraft(
            string logicalNodeId,
            string id,
            string macroRoleId,
            DungeonMacroRoleKindV2 macroRole,
            DungeonGameplayBeatKindV2 primaryBeat,
            IEnumerable<string> gameplayBeatIds,
            bool transitionOnly,
            IndustrialFactoryV2ModuleDefinition definition,
            DungeonCertifiedModulePlacementV2 placement,
            IReadOnlyDictionary<string, string> regionIds)
        {
            SlotId = DungeonV2Contract.RequireId(logicalNodeId, nameof(logicalNodeId));
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            MacroRoleId = DungeonV2Contract.RequireId(macroRoleId, nameof(macroRoleId));
            MacroRole = macroRole;
            PrimaryBeat = primaryBeat;
            GameplayBeatIds = DungeonV2Contract.CopyCanonicalIds(gameplayBeatIds, nameof(gameplayBeatIds), 1);
            TransitionOnly = transitionOnly;
            Definition = definition ?? throw new ArgumentNullException(nameof(definition));
            Placement = placement ?? throw new ArgumentNullException(nameof(placement));
            RegionIds = regionIds ?? throw new ArgumentNullException(nameof(regionIds));
        }

        // SlotId remains as the stable downstream name for authored internal
        // topology edges. It now denotes an abstract graph node, not a fixed
        // seven-room slot.
        public string SlotId { get; }
        public string Id { get; }
        public string MacroRoleId { get; }
        public DungeonMacroRoleKindV2 MacroRole { get; }
        public DungeonGameplayBeatKindV2 PrimaryBeat { get; }
        public IReadOnlyList<string> GameplayBeatIds { get; }
        public bool TransitionOnly { get; }
        public IndustrialFactoryV2ModuleDefinition Definition { get; }
        public DungeonCertifiedModulePlacementV2 Placement { get; }
        public IReadOnlyDictionary<string, string> RegionIds { get; }
    }

    internal sealed class IndustrialFactoryV2AuthoredLayoutBuilder
    {
        private readonly IIndustrialFactoryV2ModuleCatalog catalog;

        public IndustrialFactoryV2AuthoredLayoutBuilder(IIndustrialFactoryV2ModuleCatalog catalog)
        {
            this.catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        }

        public IndustrialFactoryV2AuthoredLayout Build(
            string attemptSeed,
            DungeonBiomeDistrictKindV2 hazardKind,
            int maximumBacktracks)
        {
            if (maximumBacktracks < 0) throw new ArgumentOutOfRangeException(nameof(maximumBacktracks));
            var random = new DungeonDeterministicRandom(attemptSeed + ":authored-layout");
            int graphTemplate = random.RangeInclusive(0, 5);
            bool splitSortingBeat = graphTemplate == 5;
            bool includeSurveillanceBranch = !splitSortingBeat && random.Chance(0.5d);
            bool includeMiniDungeon = random.Chance(0.65d);

            // Required ordering: progression contract first, then an abstract
            // graph that contains no descriptor, prefab, transform, or exact
            // connector identity.
            IReadOnlyList<DungeonGameplayBeatPlanV2> beats = BuildGameplayBeats();
            DungeonAbstractLayoutBlueprintV2 blueprint = BuildAbstractBlueprint(
                beats,
                hazardKind,
                graphTemplate,
                includeSurveillanceBranch);

            // Only after the graph is frozen do we consult the injected baked
            // descriptor catalog. Candidate selection and spatial embedding are
            // separate attempts so a failed embedding cannot mutate the graph.
            IReadOnlyList<ModuleCandidateSet> candidateSets = BuildCandidateSets(attemptSeed, blueprint);
            List<IndustrialFactoryV2AuthoredModuleDraft> placed = null;
            DungeonAbstractRouteGraphV2 materializedGraph = null;
            int backtracks = 0;
            for (int selectionOrdinal = 0; selectionOrdinal <= maximumBacktracks; selectionOrdinal += 1)
            {
                IReadOnlyList<SelectedModule> selected = SelectCandidateCombination(candidateSets, selectionOrdinal);
                if (TryEmbedSelectedModules(blueprint, selected, out List<IndustrialFactoryV2AuthoredModuleDraft> candidate))
                {
                    DungeonAbstractRouteGraphV2 graph = TryMaterializeExactSocketGraph(blueprint, candidate);
                    if (graph != null)
                    {
                        placed = candidate;
                        materializedGraph = graph;
                        break;
                    }
                }
                backtracks += 1;
            }
            if (placed == null || materializedGraph == null)
            {
                throw new InvalidOperationException(
                    "Authored descriptor selection/socket embedding exhausted its bounded backtracking budget ("
                        + maximumBacktracks + ").");
            }

            if (placed.Count < DungeonPlanV2.MinimumModuleCount
                || placed.Count > DungeonPlanV2.MaximumModuleCount)
                throw new InvalidOperationException("Authored layout violated the 8-14 module budget.");
            int regionCount = placed.Sum(value => value.Placement.Regions.Count);
            if (regionCount < DungeonPlanV2.MinimumRegionCount
                || regionCount > DungeonPlanV2.MaximumRegionCount)
                throw new InvalidOperationException("Authored layout violated the 12-18 region budget.");

            IReadOnlyList<DungeonGameplayBeatAssignmentV2> assignments = BuildBeatAssignments(blueprint, placed);
            IReadOnlyList<DungeonMiniDungeonCompositionGrammarV2> mini = includeMiniDungeon
                ? BuildMiniDungeonComposition(placed, materializedGraph)
                : Array.Empty<DungeonMiniDungeonCompositionGrammarV2>();
            return new IndustrialFactoryV2AuthoredLayout(
                placed,
                blueprint,
                materializedGraph,
                assignments,
                mini,
                backtracks);
        }

        private IReadOnlyList<ModuleCandidateSet> BuildCandidateSets(
            string attemptSeed,
            DungeonAbstractLayoutBlueprintV2 blueprint)
        {
            var result = new List<ModuleCandidateSet>(blueprint.Nodes.Count);
            foreach (DungeonAbstractLayoutNodeV2 node in ConstructiveOrder(blueprint))
            {
                IEnumerable<IndustrialFactoryV2ModuleDefinition> query = catalog.Definitions.Where(definition =>
                    definition.CompatibleMacroRoles.Contains(node.OwnershipRole)
                    && node.CompatibleArchetypes.Contains(definition.Composition.Archetype)
                    && definition.CertifiedGeometry.Regions.Count == 2);
                if (node.District == DungeonBiomeDistrictKindV2.MagmaUndercroft
                    || node.District == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                {
                    query = query.Where(definition => definition.CertifiedGeometry.Regions.All(region =>
                        region.DistrictKind == node.District));
                }

                IndustrialFactoryV2ModuleDefinition[] candidates = query
                    .OrderBy(value => DungeonDeterministicRandom.HashSeed(
                        attemptSeed + ":abstract-node:" + node.Id + ":" + value.TemplateId))
                    .ThenBy(value => value.TemplateId, StringComparer.Ordinal)
                    .ToArray();
                if (candidates.Length == 0)
                    throw new InvalidOperationException("No baked authored descriptor satisfies abstract node '" + node.Id + "'.");
                result.Add(new ModuleCandidateSet(node, candidates));
            }
            return Array.AsReadOnly(result.ToArray());
        }

        private static IReadOnlyList<SelectedModule> SelectCandidateCombination(
            IReadOnlyList<ModuleCandidateSet> candidateSets,
            int ordinal)
        {
            var result = new List<SelectedModule>(candidateSets.Count);
            int remaining = ordinal;
            foreach (ModuleCandidateSet set in candidateSets)
            {
                int index = remaining % set.Candidates.Count;
                remaining /= set.Candidates.Count;
                result.Add(new SelectedModule(set.Node, set.Candidates[index]));
            }
            return Array.AsReadOnly(result.ToArray());
        }

        private static bool TryEmbedSelectedModules(
            DungeonAbstractLayoutBlueprintV2 blueprint,
            IReadOnlyList<SelectedModule> selected,
            out List<IndustrialFactoryV2AuthoredModuleDraft> placed)
        {
            placed = new List<IndustrialFactoryV2AuthoredModuleDraft>(selected.Count);
            var selectedByNode = selected.ToDictionary(value => value.Node.Id, StringComparer.Ordinal);
            IReadOnlyList<DungeonAbstractLayoutNodeV2> order = ConstructiveOrder(blueprint);
            var beatKindById = blueprint.GameplayBeats.ToDictionary(value => value.Id, value => value.Kind, StringComparer.Ordinal);

            for (int index = 0; index < order.Count; index += 1)
            {
                DungeonAbstractLayoutNodeV2 node = order[index];
                SelectedModule selection = selectedByNode[node.Id];
                DungeonModuleTransformV2 transform;
                if (string.Equals(node.Id, blueprint.EntryNodeId, StringComparison.Ordinal))
                {
                    transform = DungeonModuleTransformV2.Identity;
                }
                else
                {
                    DungeonAbstractLayoutEdgeV2 placementEdge = blueprint.Edges.Single(value =>
                        value.PlacementEdge && string.Equals(value.ToNodeId, node.Id, StringComparison.Ordinal));
                    IndustrialFactoryV2AuthoredModuleDraft parent = placed.Single(value =>
                        string.Equals(value.SlotId, placementEdge.FromNodeId, StringComparison.Ordinal));
                    string inputConnectorId = LocalConnectorId(placementEdge.ToConnectorIntent);
                    CertifiedDungeonConnectorGeometryV2 input = selection.Definition.CertifiedGeometry.Connectors
                        .SingleOrDefault(value => string.Equals(value.Id, inputConnectorId, StringComparison.Ordinal));
                    DungeonModuleConnectorPlanV2 output = Connector(
                        parent.Placement,
                        LocalConnectorId(placementEdge.FromConnectorIntent));
                    if (input == null
                        || output == null
                        || !DungeonSocketPlacementSolverV2.TryAlign(input, output, out transform))
                        return false;
                }

                string moduleId = "module-authored-" + index.ToString("00") + "-" + node.Id;
                IReadOnlyDictionary<string, string> regionIds = BindRegionIds(node, selection.Definition);
                DungeonCertifiedModulePlacementV2 placement = DungeonCertifiedModulePlacementV2.Place(
                    selection.Definition,
                    moduleId,
                    regionIds.Select(value => new DungeonModuleRegionBindingV2(value.Key, value.Value)),
                    transform,
                    node.District == DungeonBiomeDistrictKindV2.MagmaUndercroft
                        || node.District == DungeonBiomeDistrictKindV2.ElectricalUndercroft
                            ? IndustrialFactoryV2Ruleset.HazardControllerId
                            : null);
                if (placed.Any(value => HorizontalOverlap(value.Placement.Bounds, placement.Bounds)))
                    return false;

                DungeonGameplayBeatKindV2 primaryBeat = node.GameplayBeatIds
                    .Select(value => beatKindById[value])
                    .OrderBy(value => (int)value)
                    .First();
                placed.Add(new IndustrialFactoryV2AuthoredModuleDraft(
                    node.Id,
                    moduleId,
                    "ownership-" + moduleId,
                    node.OwnershipRole,
                    primaryBeat,
                    node.GameplayBeatIds,
                    node.TransitionOnly,
                    selection.Definition,
                    placement,
                    regionIds));
            }
            return true;
        }

        private static DungeonAbstractRouteGraphV2 TryMaterializeExactSocketGraph(
            DungeonAbstractLayoutBlueprintV2 blueprint,
            IReadOnlyList<IndustrialFactoryV2AuthoredModuleDraft> modules)
        {
            var moduleByNode = modules.ToDictionary(value => value.SlotId, StringComparer.Ordinal);
            var nodes = blueprint.Nodes.Select(node =>
            {
                IndustrialFactoryV2AuthoredModuleDraft module = moduleByNode[node.Id];
                return new DungeonAbstractRouteNodeV2(module.Id, node.District, node.TransitionOnly);
            }).ToArray();
            var edges = new List<DungeonAbstractRouteEdgeV2>(blueprint.Edges.Count);
            foreach (DungeonAbstractLayoutEdgeV2 edge in blueprint.Edges)
            {
                IndustrialFactoryV2AuthoredModuleDraft from = moduleByNode[edge.FromNodeId];
                IndustrialFactoryV2AuthoredModuleDraft to = moduleByNode[edge.ToNodeId];
                string fromConnectorId = PlacedConnectorId(from, LocalConnectorId(edge.FromConnectorIntent));
                string toConnectorId = PlacedConnectorId(to, LocalConnectorId(edge.ToConnectorIntent));
                DungeonModuleConnectorPlanV2 fromConnector = from.Placement.Connectors.Single(value => value.Id == fromConnectorId);
                DungeonModuleConnectorPlanV2 toConnector = to.Placement.Connectors.Single(value => value.Id == toConnectorId);
                if (!DungeonAbstractRouteSocketValidatorV2.IsExactPair(fromConnector, toConnector))
                    return null;
                edges.Add(new DungeonAbstractRouteEdgeV2(
                    edge.Id,
                    from.Id,
                    to.Id,
                    edge.Role,
                    edge.Bidirectional,
                    fromConnectorId,
                    toConnectorId));
            }
            return new DungeonAbstractRouteGraphV2(nodes, edges);
        }

        private static IReadOnlyDictionary<string, string> BindRegionIds(
            DungeonAbstractLayoutNodeV2 node,
            IndustrialFactoryV2ModuleDefinition definition)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (CertifiedDungeonRegionGeometryV2 region in definition.CertifiedGeometry.Regions)
            {
                string placedId = string.Equals(region.Id, "entry", StringComparison.Ordinal)
                    ? node.PrimaryRegionId
                    : string.Equals(region.Id, "lower", StringComparison.Ordinal)
                        ? node.SecondaryRegionId
                        : "region-" + node.Id + "-" + region.Id;
                result.Add(region.Id, placedId);
            }
            if (result.Values.Distinct(StringComparer.Ordinal).Count() != result.Count)
                throw new InvalidOperationException("Authored region bindings must be one-to-one for abstract node '" + node.Id + "'.");
            return result;
        }

        private static DungeonModuleConnectorPlanV2 Connector(
            DungeonCertifiedModulePlacementV2 placement,
            string localConnectorId)
        {
            CertifiedDungeonConnectorGeometryV2 local = placement.Source.Connectors.SingleOrDefault(value =>
                string.Equals(value.Id, localConnectorId, StringComparison.Ordinal));
            if (local == null) return null;
            string placedRegionId = placement.RegionIds[local.RegionId];
            string connectorId = DungeonCertifiedModulePlacementV2.PlacedConnectorId(placedRegionId, local.Id);
            return placement.Connectors.Single(value => string.Equals(value.Id, connectorId, StringComparison.Ordinal));
        }

        private static bool HorizontalOverlap(DungeonBounds3 left, DungeonBounds3 right)
        {
            const double tolerance = 1e-9d;
            return left.Minimum.X < right.Maximum.X - tolerance
                && left.Maximum.X > right.Minimum.X + tolerance
                && left.Minimum.Z < right.Maximum.Z - tolerance
                && left.Maximum.Z > right.Minimum.Z + tolerance;
        }

        private static IReadOnlyList<DungeonGameplayBeatPlanV2> BuildGameplayBeats()
        {
            return Array.AsReadOnly(new[]
            {
                Beat(DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat(DungeonGameplayBeatKindV2.AssemblyFloor, DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat(DungeonGameplayBeatKindV2.BrokenFreightShaft, DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat(DungeonGameplayBeatKindV2.SortingGantry, DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat(DungeonGameplayBeatKindV2.NestWarehouse, DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat(
                    DungeonGameplayBeatKindV2.CredentialTower,
                    DungeonGameplayBeatKindV2.SortingGantry,
                    DungeonGameplayBeatKindV2.NestWarehouse),
                Beat(DungeonGameplayBeatKindV2.MachineCore, DungeonGameplayBeatKindV2.CredentialTower)
            });
        }

        private static DungeonAbstractLayoutBlueprintV2 BuildAbstractBlueprint(
            IReadOnlyList<DungeonGameplayBeatPlanV2> beats,
            DungeonBiomeDistrictKindV2 hazardKind,
            int graphTemplate,
            bool includeSurveillanceBranch)
        {
            bool splitSorting = graphTemplate == 5;
            var nodes = new List<DungeonAbstractLayoutNodeV2>
            {
                Node("security", DungeonMacroRoleKindV2.SecurityEntrance, DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.SecurityEntrance },
                    "factory-security-entrance", "factory-pocket-security",
                    DungeonModuleArchetypeV2.SecurityCheckpoint, DungeonModuleArchetypeV2.AncientServerCrypt),
                Node("assembly", DungeonMacroRoleKindV2.AssemblyFloor, DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.AssemblyFloor },
                    "factory-assembly-floor", "factory-pocket-assembly",
                    DungeonModuleArchetypeV2.AssemblyLineHall, DungeonModuleArchetypeV2.ReaverbotRechargeChamber),
                Node("broken-freight", DungeonMacroRoleKindV2.BrokenFreightShaft, DungeonBiomeDistrictKindV2.Waterworks,
                    new[] { DungeonGameplayBeatKindV2.BrokenFreightShaft },
                    "factory-broken-freight-shaft", "water-freight-sump",
                    DungeonModuleArchetypeV2.VerticalMaintenanceShaft, DungeonModuleArchetypeV2.FluidTankChamber),
                Node(splitSorting ? "sorting-pump" : "sorting", DungeonMacroRoleKindV2.SortingGantry,
                    DungeonBiomeDistrictKindV2.Waterworks,
                    new[] { DungeonGameplayBeatKindV2.SortingGantry },
                    "factory-sorting-gantry", "water-reservoir-service",
                    DungeonModuleArchetypeV2.PumpAndCoolantWorks),
                Node("nest", DungeonMacroRoleKindV2.NestWarehouse, DungeonBiomeDistrictKindV2.Waterworks,
                    new[] { DungeonGameplayBeatKindV2.NestWarehouse },
                    "factory-nest-warehouse", "water-gantry-sump",
                    DungeonModuleArchetypeV2.ReaverbotNest, DungeonModuleArchetypeV2.StorageVaultPartsWarehouse),
                Node("credential", DungeonMacroRoleKindV2.CredentialTower, DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.CredentialTower },
                    "factory-credential-tower", "factory-pocket-credential",
                    DungeonModuleArchetypeV2.SecurityCheckpoint, DungeonModuleArchetypeV2.AncientServerCrypt),
                Node("machine-core", DungeonMacroRoleKindV2.MachineCore, DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.MachineCore },
                    "factory-machine-core", "factory-pocket-machine-core",
                    DungeonModuleArchetypeV2.ReactorSupportChamber, DungeonModuleArchetypeV2.SurveillanceControlTheater),
                Node("hazard-undercroft", DungeonMacroRoleKindV2.CredentialTower, hazardKind,
                    new[] { DungeonGameplayBeatKindV2.CredentialTower, DungeonGameplayBeatKindV2.MachineCore },
                    "hazard-undercroft-landing", "hazard-undercroft-basin",
                    DungeonModuleArchetypeV2.HazardProcessingRoom)
            };
            if (splitSorting)
            {
                // A genuine split beat: the routing controls and the traversal
                // bridge are separate authored modules in one Sorting beat.
                nodes.Add(Node(
                    "sorting-bridge",
                    DungeonMacroRoleKindV2.SortingGantry,
                    DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.SortingGantry },
                    "factory-sorting-bridge",
                    "factory-pocket-sorting-bridge",
                    DungeonModuleArchetypeV2.ReactorSupportChamber));
            }
            if (includeSurveillanceBranch)
            {
                nodes.Add(Node(
                    "surveillance-branch",
                    DungeonMacroRoleKindV2.NestWarehouse,
                    DungeonBiomeDistrictKindV2.Factory,
                    new[] { DungeonGameplayBeatKindV2.NestWarehouse },
                    "factory-surveillance-branch",
                    "factory-pocket-surveillance",
                    DungeonModuleArchetypeV2.SurveillanceControlTheater));
            }

            var edges = new List<DungeonAbstractLayoutEdgeV2>();
            string sorting = splitSorting ? "sorting-pump" : "sorting";
            string[] criticalPath;
            switch (graphTemplate)
            {
                case 0:
                    criticalPath = new[] { "security", "assembly", "broken-freight", sorting, "nest", "credential", "machine-core" };
                    break;
                case 1:
                    criticalPath = new[] { "security", "assembly", "nest", "broken-freight", sorting, "credential", "machine-core" };
                    break;
                case 2:
                    criticalPath = new[] { "security", "assembly", "broken-freight", sorting, "credential", "machine-core" };
                    AddEdge(edges, "factory-nest-detour", sorting, DungeonAbstractConnectorIntentV2.Branch,
                        "nest", DungeonAbstractConnectorIntentV2.Entry, DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
                    break;
                case 3:
                    criticalPath = new[] { "security", "broken-freight", sorting, "credential", "machine-core" };
                    AddEdge(edges, "factory-assembly-branch", "security", DungeonAbstractConnectorIntentV2.Branch,
                        "assembly", DungeonAbstractConnectorIntentV2.Entry, DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
                    AddEdge(edges, "factory-nest-detour", sorting, DungeonAbstractConnectorIntentV2.Branch,
                        "nest", DungeonAbstractConnectorIntentV2.Entry, DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
                    break;
                case 4:
                    criticalPath = new[] { "security", "nest", "broken-freight", sorting, "credential", "machine-core" };
                    AddEdge(edges, "factory-assembly-branch", "security", DungeonAbstractConnectorIntentV2.Branch,
                        "assembly", DungeonAbstractConnectorIntentV2.Entry, DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
                    break;
                case 5:
                    criticalPath = new[]
                    {
                        "security", "assembly", "broken-freight", "sorting-pump", "sorting-bridge", "credential", "machine-core"
                    };
                    AddEdge(edges, "factory-nest-detour", "sorting-pump", DungeonAbstractConnectorIntentV2.Branch,
                        "nest", DungeonAbstractConnectorIntentV2.Entry, DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(graphTemplate));
            }
            for (int index = 0; index < criticalPath.Length - 1; index += 1)
            {
                AddEdge(edges, "factory-main-" + graphTemplate + "-" + index,
                    criticalPath[index], DungeonAbstractConnectorIntentV2.Forward,
                    criticalPath[index + 1], DungeonAbstractConnectorIntentV2.Entry,
                    DungeonAbstractRouteEdgeRoleV2.Critical, false, true);
            }

            AddEdge(edges, "waterworks-lower-first",
                "broken-freight", DungeonAbstractConnectorIntentV2.LowerForward,
                sorting, DungeonAbstractConnectorIntentV2.LowerEntry,
                DungeonAbstractRouteEdgeRoleV2.DistrictTransition, true, false);
            bool nestBeforeFreight = graphTemplate == 1 || graphTemplate == 4;
            AddEdge(edges, "waterworks-lower-rejoin",
                nestBeforeFreight ? "broken-freight" : sorting,
                nestBeforeFreight
                    ? DungeonAbstractConnectorIntentV2.LowerEntry
                    : graphTemplate == 2 || graphTemplate == 3 || graphTemplate == 5
                        ? DungeonAbstractConnectorIntentV2.LowerBranch
                        : DungeonAbstractConnectorIntentV2.LowerForward,
                "nest",
                nestBeforeFreight
                    ? DungeonAbstractConnectorIntentV2.LowerForward
                    : DungeonAbstractConnectorIntentV2.LowerEntry,
                DungeonAbstractRouteEdgeRoleV2.Return, true, false);
            AddEdge(edges, "hazard-optional-branch",
                "broken-freight", DungeonAbstractConnectorIntentV2.Branch,
                "hazard-undercroft", DungeonAbstractConnectorIntentV2.Entry,
                DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
            AddEdge(edges, "hazard-safe-return",
                "broken-freight", DungeonAbstractConnectorIntentV2.LowerBranch,
                "hazard-undercroft", DungeonAbstractConnectorIntentV2.LowerEntry,
                DungeonAbstractRouteEdgeRoleV2.Return, true, false);

            if (includeSurveillanceBranch)
            {
                // Select an unrotated main-route host whose north aperture is
                // unused. Chaining another north intent from the already
                // quarter-turned Nest would point sideways and can collide with
                // the Sorting envelope despite being graph-valid.
                string parent = graphTemplate == 3
                    ? "nest"
                    : graphTemplate == 4
                        ? sorting
                        : "assembly";
                DungeonAbstractConnectorIntentV2 parentIntent = graphTemplate == 3
                    ? DungeonAbstractConnectorIntentV2.Forward
                    : DungeonAbstractConnectorIntentV2.Branch;
                AddEdge(edges, "nest-surveillance-branch",
                    parent, parentIntent,
                    "surveillance-branch", DungeonAbstractConnectorIntentV2.Entry,
                    DungeonAbstractRouteEdgeRoleV2.Optional, true, true);
            }

            return new DungeonAbstractLayoutBlueprintV2(beats, nodes, edges, "security");
        }

        private static DungeonAbstractLayoutNodeV2 Node(
            string id,
            DungeonMacroRoleKindV2 role,
            DungeonBiomeDistrictKindV2 district,
            IEnumerable<DungeonGameplayBeatKindV2> beats,
            string primaryRegionId,
            string secondaryRegionId,
            params DungeonModuleArchetypeV2[] archetypes) =>
            new DungeonAbstractLayoutNodeV2(
                id,
                role,
                district,
                beats.Select(BeatId),
                archetypes,
                primaryRegionId,
                secondaryRegionId,
                transitionOnly: false);

        private static void AddEdge(
            ICollection<DungeonAbstractLayoutEdgeV2> edges,
            string id,
            string from,
            DungeonAbstractConnectorIntentV2 fromIntent,
            string to,
            DungeonAbstractConnectorIntentV2 toIntent,
            DungeonAbstractRouteEdgeRoleV2 role,
            bool bidirectional,
            bool placementEdge) => edges.Add(new DungeonAbstractLayoutEdgeV2(
                id, from, fromIntent, to, toIntent, role, bidirectional, placementEdge));

        private static IReadOnlyList<DungeonAbstractLayoutNodeV2> ConstructiveOrder(
            DungeonAbstractLayoutBlueprintV2 blueprint)
        {
            var result = new List<DungeonAbstractLayoutNodeV2>(blueprint.Nodes.Count);
            var remaining = new List<DungeonAbstractLayoutNodeV2>(blueprint.Nodes);
            while (remaining.Count > 0)
            {
                DungeonAbstractLayoutNodeV2 next = remaining
                    .Where(node => string.Equals(node.Id, blueprint.EntryNodeId, StringComparison.Ordinal)
                        ? result.Count == 0
                        : blueprint.Edges.Any(edge => edge.PlacementEdge
                            && edge.ToNodeId == node.Id
                            && result.Any(parent => parent.Id == edge.FromNodeId)))
                    .OrderBy(value => value.Id, StringComparer.Ordinal)
                    .FirstOrDefault();
                if (next == null)
                    throw new InvalidOperationException("Abstract layout placement dependencies contain a cycle.");
                result.Add(next);
                remaining.Remove(next);
            }
            return Array.AsReadOnly(result.ToArray());
        }

        private static IReadOnlyList<DungeonGameplayBeatAssignmentV2> BuildBeatAssignments(
            DungeonAbstractLayoutBlueprintV2 blueprint,
            IReadOnlyList<IndustrialFactoryV2AuthoredModuleDraft> modules)
        {
            var result = new List<DungeonGameplayBeatAssignmentV2>();
            foreach (DungeonGameplayBeatPlanV2 beat in blueprint.GameplayBeats)
            {
                string[] moduleIds = modules
                    .Where(value => value.GameplayBeatIds.Contains(beat.Id))
                    .Select(value => value.Id)
                    .ToArray();
                result.Add(new DungeonGameplayBeatAssignmentV2(beat.Id, moduleIds));
            }
            return Array.AsReadOnly(result.ToArray());
        }

        private static IReadOnlyList<DungeonMiniDungeonCompositionGrammarV2> BuildMiniDungeonComposition(
            IReadOnlyList<IndustrialFactoryV2AuthoredModuleDraft> modules,
            DungeonAbstractRouteGraphV2 graph)
        {
            IndustrialFactoryV2AuthoredModuleDraft broken = ByNode(modules, "broken-freight");
            IndustrialFactoryV2AuthoredModuleDraft sorting = modules.Single(value =>
                value.GameplayBeatIds.Contains(BeatId(DungeonGameplayBeatKindV2.SortingGantry))
                && value.RegionIds.Values.Contains("factory-sorting-gantry"));
            IndustrialFactoryV2AuthoredModuleDraft nest = ByNode(modules, "nest");
            const string rejoinEdgeId = "waterworks-lower-rejoin";
            if (!graph.Edges.Any(value => string.Equals(value.Id, rejoinEdgeId, StringComparison.Ordinal)))
                throw new InvalidOperationException("Waterworks mini-dungeon requires its exact lower rejoin edge.");
            return new[]
            {
                new DungeonMiniDungeonCompositionGrammarV2(
                    "mini-dungeon-nest-warehouse",
                    new[] { broken.Id, sorting.Id, nest.Id },
                    new[] { broken.Id, sorting.Id },
                    broken.Id,
                    nest.Id,
                    "mechanism-nest-warehouse-routing",
                    DungeonMiniDungeonMechanismKindV2.VerticalWaterRouting,
                    true,
                    nest.Id,
                    rejoinEdgeId)
            };
        }

        private static IndustrialFactoryV2AuthoredModuleDraft ByNode(
            IEnumerable<IndustrialFactoryV2AuthoredModuleDraft> modules,
            string nodeId) => modules.Single(value => string.Equals(value.SlotId, nodeId, StringComparison.Ordinal));

        private static string PlacedConnectorId(
            IndustrialFactoryV2AuthoredModuleDraft module,
            string localConnectorId)
        {
            CertifiedDungeonConnectorGeometryV2 local = module.Definition.CertifiedGeometry.Connectors.Single(value =>
                string.Equals(value.Id, localConnectorId, StringComparison.Ordinal));
            return DungeonCertifiedModulePlacementV2.PlacedConnectorId(
                module.RegionIds[local.RegionId],
                local.Id);
        }

        private static string LocalConnectorId(DungeonAbstractConnectorIntentV2 intent)
        {
            switch (intent)
            {
                case DungeonAbstractConnectorIntentV2.Entry: return "west";
                case DungeonAbstractConnectorIntentV2.Forward: return "east";
                case DungeonAbstractConnectorIntentV2.Branch: return "north";
                case DungeonAbstractConnectorIntentV2.LowerEntry: return "lower-west";
                case DungeonAbstractConnectorIntentV2.LowerForward: return "lower-east";
                case DungeonAbstractConnectorIntentV2.LowerBranch: return "lower-north";
                default: throw new ArgumentOutOfRangeException(nameof(intent));
            }
        }

        private static DungeonGameplayBeatPlanV2 Beat(
            DungeonGameplayBeatKindV2 kind,
            params DungeonGameplayBeatKindV2[] prerequisites) =>
            new DungeonGameplayBeatPlanV2(BeatId(kind), kind, prerequisites.Select(BeatId));

        private static string BeatId(DungeonGameplayBeatKindV2 kind) =>
            "beat-" + ToKebab(kind.ToString());

        private static string ToKebab(string value)
        {
            var characters = new List<char>(value.Length + 8);
            for (int index = 0; index < value.Length; index += 1)
            {
                char character = value[index];
                if (index > 0 && char.IsUpper(character)) characters.Add('-');
                characters.Add(char.ToLowerInvariant(character));
            }
            return new string(characters.ToArray());
        }

        private sealed class ModuleCandidateSet
        {
            public ModuleCandidateSet(
                DungeonAbstractLayoutNodeV2 node,
                IEnumerable<IndustrialFactoryV2ModuleDefinition> candidates)
            {
                Node = node;
                Candidates = Array.AsReadOnly(candidates.ToArray());
            }

            public DungeonAbstractLayoutNodeV2 Node { get; }
            public IReadOnlyList<IndustrialFactoryV2ModuleDefinition> Candidates { get; }
        }

        private sealed class SelectedModule
        {
            public SelectedModule(DungeonAbstractLayoutNodeV2 node, IndustrialFactoryV2ModuleDefinition definition)
            {
                Node = node;
                Definition = definition;
            }

            public DungeonAbstractLayoutNodeV2 Node { get; }
            public IndustrialFactoryV2ModuleDefinition Definition { get; }
        }
    }
}
