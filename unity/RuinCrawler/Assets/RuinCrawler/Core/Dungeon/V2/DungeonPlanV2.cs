using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Immutable schema-3 dungeon source. Construction canonicalizes unordered
    /// arrays and rejects broken ownership or cross-reference contracts.
    /// </summary>
    public sealed class DungeonPlanV2 : IEquatable<DungeonPlanV2>
    {
        public const int CurrentSchemaVersion = 3;
        public const int RequiredGameplayBeatCount = 7;
        public const int MinimumModuleCount = 8;
        public const int MaximumModuleCount = 14;
        public const int MinimumRegionCount = 12;
        public const int MaximumRegionCount = 18;

        public DungeonPlanV2(
            int schemaVersion,
            int contractVersion,
            string rulesetVersion,
            string profileId,
            string contentPackVersion,
            string seed,
            string attemptSeed,
            int generationAttempt,
            int difficulty,
            string entranceRegionId,
            string extractionRegionId,
            DungeonBounds3 bounds,
            DungeonVoidPolicyV2 voidPolicy,
            IEnumerable<DungeonMacroRolePlanV2> macroRoles,
            IEnumerable<DungeonModuleInstancePlanV2> modules,
            IEnumerable<DungeonModuleConnectorPlanV2> connectors,
            IEnumerable<DungeonAnchorPlanV2> anchors,
            IEnumerable<DungeonRegionPlanV2> regions,
            IEnumerable<DungeonBiomeDistrictPlanV2> districts,
            IEnumerable<DungeonTraversalEdgePlanV2> traversalEdges,
            IEnumerable<DungeonExplorationRoutePlanV2> routes,
            IEnumerable<DungeonDiscoveryPlanV2> discoveries,
            IEnumerable<DungeonShortcutPlanV2> shortcuts,
            IEnumerable<DungeonSurfacePlanV2> surfaces,
            IEnumerable<DungeonFluidZonePlanV2> fluidZones,
            IEnumerable<DungeonFluidNetworkPlanV2> fluidNetworks,
            IEnumerable<DungeonEnvironmentControllerPlanV2> environmentControllers,
            IEnumerable<DungeonFallCatchmentPlanV2> fallCatchments,
            IEnumerable<DungeonFallExposurePlanV2> fallExposures,
            IEnumerable<DungeonGameplayBeatPlanV2> gameplayBeats = null,
            DungeonAbstractRouteGraphV2 abstractRouteGraph = null,
            IEnumerable<DungeonGameplayBeatAssignmentV2> beatAssignments = null,
            IEnumerable<DungeonMiniDungeonCompositionGrammarV2> miniDungeonCompositions = null)
        {
            if (schemaVersion != CurrentSchemaVersion)
            {
                throw new ArgumentOutOfRangeException(nameof(schemaVersion), schemaVersion, "DungeonPlanV2 requires schema 3.");
            }

            if (contractVersion <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(contractVersion));
            }

            if (generationAttempt < 0 || generationAttempt >= 12)
            {
                throw new ArgumentOutOfRangeException(nameof(generationAttempt), "Generation attempt must be in [0, 11].");
            }

            if (difficulty < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(difficulty));
            }

            if (voidPolicy != DungeonVoidPolicyV2.Prohibited)
            {
                throw new ArgumentOutOfRangeException(nameof(voidPolicy));
            }

            SchemaVersion = schemaVersion;
            ContractVersion = contractVersion;
            RulesetVersion = DungeonV2Contract.RequireId(rulesetVersion, nameof(rulesetVersion));
            ProfileId = DungeonV2Contract.RequireId(profileId, nameof(profileId));
            ContentPackVersion = DungeonV2Contract.RequireId(contentPackVersion, nameof(contentPackVersion));
            Seed = DungeonV2Contract.RequireId(seed, nameof(seed));
            AttemptSeed = DungeonV2Contract.RequireId(attemptSeed, nameof(attemptSeed));
            GenerationAttempt = generationAttempt;
            Difficulty = difficulty;
            EntranceRegionId = DungeonV2Contract.RequireId(entranceRegionId, nameof(entranceRegionId));
            ExtractionRegionId = DungeonV2Contract.RequireId(extractionRegionId, nameof(extractionRegionId));
            Bounds = bounds;
            VoidPolicy = voidPolicy;
            MacroRoles = DungeonV2Contract.CopyCanonical(macroRoles, value => value.Id, nameof(macroRoles));
            Modules = DungeonV2Contract.CopyCanonical(modules, value => value.Id, nameof(modules));
            Connectors = DungeonV2Contract.CopyCanonical(connectors, value => value.Id, nameof(connectors));
            Anchors = DungeonV2Contract.CopyCanonical(anchors, value => value.Id, nameof(anchors));
            Regions = DungeonV2Contract.CopyCanonical(regions, value => value.Id, nameof(regions));
            Districts = DungeonV2Contract.CopyCanonical(districts, value => value.Id, nameof(districts));
            TraversalEdges = DungeonV2Contract.CopyCanonical(
                traversalEdges,
                value => value.Id,
                nameof(traversalEdges));
            Routes = DungeonV2Contract.CopyCanonical(routes, value => value.Id, nameof(routes));
            Discoveries = DungeonV2Contract.CopyCanonical(discoveries, value => value.Id, nameof(discoveries));
            Shortcuts = DungeonV2Contract.CopyCanonical(shortcuts, value => value.Id, nameof(shortcuts));
            Surfaces = DungeonV2Contract.CopyCanonical(surfaces, value => value.Id, nameof(surfaces));
            FluidZones = DungeonV2Contract.CopyCanonical(fluidZones, value => value.Id, nameof(fluidZones));
            FluidNetworks = DungeonV2Contract.CopyCanonical(
                fluidNetworks,
                value => value.Id,
                nameof(fluidNetworks));
            EnvironmentControllers = DungeonV2Contract.CopyCanonical(
                environmentControllers,
                value => value.Id,
                nameof(environmentControllers));
            FallCatchments = DungeonV2Contract.CopyCanonical(
                fallCatchments,
                value => value.Id,
                nameof(fallCatchments));
            FallExposures = DungeonV2Contract.CopyCanonical(
                fallExposures,
                value => value.Id,
                nameof(fallExposures));
            if (gameplayBeats == null) throw new ArgumentNullException(nameof(gameplayBeats));
            if (abstractRouteGraph == null) throw new ArgumentNullException(nameof(abstractRouteGraph));
            if (beatAssignments == null) throw new ArgumentNullException(nameof(beatAssignments));
            GameplayBeats = DungeonV2Contract.CopyCanonical(
                gameplayBeats,
                value => value.Id,
                nameof(gameplayBeats));
            AbstractRouteGraph = abstractRouteGraph;
            BeatAssignments = DungeonV2Contract.CopyCanonical(
                beatAssignments,
                value => value.BeatId,
                nameof(beatAssignments));
            MiniDungeonCompositions = DungeonV2Contract.CopyCanonical(
                miniDungeonCompositions ?? Array.Empty<DungeonMiniDungeonCompositionGrammarV2>(),
                value => value.Id,
                nameof(miniDungeonCompositions));

            ValidateAggregate();
            DeterministicSignature = BuildDeterministicSignature();
        }

        public int SchemaVersion { get; }
        public int ContractVersion { get; }
        public string RulesetVersion { get; }
        public string ProfileId { get; }
        public string ContentPackVersion { get; }
        public string Seed { get; }
        public string AttemptSeed { get; }
        public int GenerationAttempt { get; }
        public int Difficulty { get; }
        public string EntranceRegionId { get; }
        public string ExtractionRegionId { get; }
        public DungeonBounds3 Bounds { get; }
        public DungeonVoidPolicyV2 VoidPolicy { get; }
        public IReadOnlyList<DungeonMacroRolePlanV2> MacroRoles { get; }
        public IReadOnlyList<DungeonModuleInstancePlanV2> Modules { get; }
        public IReadOnlyList<DungeonModuleConnectorPlanV2> Connectors { get; }
        public IReadOnlyList<DungeonAnchorPlanV2> Anchors { get; }
        public IReadOnlyList<DungeonRegionPlanV2> Regions { get; }
        public IReadOnlyList<DungeonBiomeDistrictPlanV2> Districts { get; }
        public IReadOnlyList<DungeonTraversalEdgePlanV2> TraversalEdges { get; }
        public IReadOnlyList<DungeonExplorationRoutePlanV2> Routes { get; }
        public IReadOnlyList<DungeonDiscoveryPlanV2> Discoveries { get; }
        public IReadOnlyList<DungeonShortcutPlanV2> Shortcuts { get; }
        public IReadOnlyList<DungeonSurfacePlanV2> Surfaces { get; }
        public IReadOnlyList<DungeonFluidZonePlanV2> FluidZones { get; }
        public IReadOnlyList<DungeonFluidNetworkPlanV2> FluidNetworks { get; }
        public IReadOnlyList<DungeonEnvironmentControllerPlanV2> EnvironmentControllers { get; }
        public IReadOnlyList<DungeonFallCatchmentPlanV2> FallCatchments { get; }
        public IReadOnlyList<DungeonFallExposurePlanV2> FallExposures { get; }
        public IReadOnlyList<DungeonGameplayBeatPlanV2> GameplayBeats { get; }
        public DungeonAbstractRouteGraphV2 AbstractRouteGraph { get; }
        public IReadOnlyList<DungeonGameplayBeatAssignmentV2> BeatAssignments { get; }
        public IReadOnlyList<DungeonMiniDungeonCompositionGrammarV2> MiniDungeonCompositions { get; }
        public string DeterministicSignature { get; }

        public bool Equals(DungeonPlanV2 other)
        {
            return other != null
                && string.Equals(DeterministicSignature, other.DeterministicSignature, StringComparison.Ordinal);
        }

        public override bool Equals(object obj) => Equals(obj as DungeonPlanV2);
        public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(DeterministicSignature);

        private void ValidateAggregate()
        {
            if (MacroRoles.Count == 0)
                throw new ArgumentException("At least one compatibility ownership group is required.", nameof(MacroRoles));
            if (Regions.Count < MinimumRegionCount || Regions.Count > MaximumRegionCount)
            {
                throw new ArgumentException("DungeonPlanV2 requires 12-18 playable regions.", nameof(Regions));
            }
            if (Modules.Count < MinimumModuleCount || Modules.Count > MaximumModuleCount)
                throw new ArgumentException("DungeonPlanV2 requires 8-14 authored module instances.", nameof(Modules));

            RequireCount(Districts.Count, 3, nameof(Districts));
            RequireReference(Regions, EntranceRegionId, value => value.Id, nameof(EntranceRegionId));
            RequireReference(Regions, ExtractionRegionId, value => value.Id, nameof(ExtractionRegionId));
            ValidateMacroRoles();
            ValidateGenerationAuthority();
            ValidateDistricts();
            ValidateModulesRegionsAnchors();
            ValidateTraversalAndDiscoveries();
            ValidateEnvironment();
            ValidateFallContracts();
        }

        private void ValidateGenerationAuthority()
        {
            RequireCount(GameplayBeats.Count, RequiredGameplayBeatCount, nameof(GameplayBeats));
            var kinds = new HashSet<DungeonGameplayBeatKindV2>();
            var beatIds = new HashSet<string>(GameplayBeats.Select(value => value.Id), StringComparer.Ordinal);
            foreach (DungeonGameplayBeatPlanV2 beat in GameplayBeats)
            {
                if (!kinds.Add(beat.Kind))
                    throw new ArgumentException("Gameplay beat kinds must be unique.", nameof(GameplayBeats));
                foreach (string prerequisiteId in beat.PrerequisiteBeatIds)
                {
                    if (!beatIds.Contains(prerequisiteId) || prerequisiteId == beat.Id)
                        throw new ArgumentException("Gameplay beat prerequisite is missing or self-referential.", nameof(GameplayBeats));
                }
            }
            foreach (DungeonGameplayBeatKindV2 kind in Enum.GetValues(typeof(DungeonGameplayBeatKindV2)))
            {
                if (!kinds.Contains(kind))
                    throw new ArgumentException("Missing gameplay beat: " + kind, nameof(GameplayBeats));
            }

            var resolved = new HashSet<string>(StringComparer.Ordinal);
            bool progressed;
            do
            {
                progressed = false;
                foreach (DungeonGameplayBeatPlanV2 beat in GameplayBeats)
                {
                    if (resolved.Contains(beat.Id)
                        || beat.PrerequisiteBeatIds.Any(value => !resolved.Contains(value))) continue;
                    resolved.Add(beat.Id);
                    progressed = true;
                }
            } while (progressed);
            if (resolved.Count != GameplayBeats.Count)
                throw new ArgumentException("Gameplay beat partial order contains a cycle.", nameof(GameplayBeats));

            var moduleIds = new HashSet<string>(Modules.Select(value => value.Id), StringComparer.Ordinal);
            var routeNodeIds = new HashSet<string>(AbstractRouteGraph.Nodes.Select(value => value.Id), StringComparer.Ordinal);
            if (!routeNodeIds.SetEquals(moduleIds))
                throw new ArgumentException("Abstract route nodes must map one-to-one to selected module instances.", nameof(AbstractRouteGraph));

            var assignedBeatIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonGameplayBeatAssignmentV2 assignment in BeatAssignments)
            {
                if (!beatIds.Contains(assignment.BeatId) || !assignedBeatIds.Add(assignment.BeatId))
                    throw new ArgumentException("Each known gameplay beat requires exactly one assignment record.", nameof(BeatAssignments));
                foreach (string moduleId in assignment.ModuleInstanceIds)
                {
                    if (!moduleIds.Contains(moduleId))
                        throw new ArgumentException("Beat assignment references an unknown module.", nameof(BeatAssignments));
                }
            }
            if (!assignedBeatIds.SetEquals(beatIds))
                throw new ArgumentException("Every gameplay beat must be assigned to one or more modules.", nameof(BeatAssignments));

            if (MiniDungeonCompositions.Count > DungeonMiniDungeonCompositionGrammarV2.MaximumCompositionsPerPlan)
                throw new ArgumentException("At most one mini-dungeon composition is allowed.", nameof(MiniDungeonCompositions));
            foreach (DungeonMiniDungeonCompositionGrammarV2 composition in MiniDungeonCompositions)
            {
                foreach (string moduleId in composition.ModuleInstanceIds)
                {
                    if (!moduleIds.Contains(moduleId))
                        throw new ArgumentException("Mini-dungeon composition references an unknown module.", nameof(MiniDungeonCompositions));
                }
                if (!routeNodeIds.Contains(composition.RewardBranchNodeId)
                    || !routeNodeIds.Contains(composition.EntryNodeId)
                    || !routeNodeIds.Contains(composition.CriticalExitNodeId)
                    || composition.RouteDecisionNodeIds.Any(value => !routeNodeIds.Contains(value)))
                    throw new ArgumentException("Mini-dungeon route nodes must belong to the abstract route graph.", nameof(MiniDungeonCompositions));
                DungeonAbstractRouteEdgeV2 rejoin = AbstractRouteGraph.Edges.SingleOrDefault(value =>
                    string.Equals(value.Id, composition.LoopOrRejoinEdgeId, StringComparison.Ordinal));
                if (rejoin == null
                    || !composition.ModuleInstanceIds.Contains(rejoin.FromNodeId)
                    || !composition.ModuleInstanceIds.Contains(rejoin.ToNodeId))
                    throw new ArgumentException(
                        "Mini-dungeon loop/rejoin edge must connect two modules inside the composition.",
                        nameof(MiniDungeonCompositions));
                if (!composition.VerticalMechanism)
                    throw new ArgumentException("Mini-dungeon mechanism must be vertical.", nameof(MiniDungeonCompositions));
            }
        }

        private void ValidateMacroRoles()
        {
            var ownedModules = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonMacroRolePlanV2 macro in MacroRoles)
            {
                foreach (string moduleId in macro.ModuleInstanceIds)
                {
                    if (!ownedModules.Add(moduleId))
                        throw new ArgumentException("Compatibility ownership groups may not share a module.", nameof(MacroRoles));
                    DungeonModuleInstancePlanV2 module = RequireReference(
                        Modules,
                        moduleId,
                        value => value.Id,
                        nameof(MacroRoles));
                    RequireEqual(macro.Id, module.MacroRoleId, "Macro/module ownership mismatch.", nameof(MacroRoles));
                }
            }
            if (!ownedModules.SetEquals(Modules.Select(value => value.Id)))
                throw new ArgumentException("Every module must belong to exactly one compatibility ownership group.", nameof(MacroRoles));
        }

        private void ValidateDistricts()
        {
            DungeonBiomeDistrictPlanV2 factory = SingleDistrict(DungeonBiomeDistrictKindV2.Factory);
            DungeonBiomeDistrictPlanV2 waterworks = SingleDistrict(DungeonBiomeDistrictKindV2.Waterworks);
            int hazardCount = CountDistricts(DungeonBiomeDistrictKindV2.MagmaUndercroft)
                + CountDistricts(DungeonBiomeDistrictKindV2.ElectricalUndercroft);
            if (hazardCount != 1)
            {
                throw new ArgumentException("Exactly one compatible Hazard Undercroft district is required.", nameof(Districts));
            }

            if (waterworks.RegionIds.Count < 3)
            {
                throw new ArgumentException("Waterworks must span at least three regions.", nameof(Districts));
            }

            DungeonBiomeDistrictPlanV2 hazard = Districts[0];
            foreach (DungeonBiomeDistrictPlanV2 district in Districts)
            {
                if (district.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                    || district.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                {
                    hazard = district;
                }
            }

            if (hazard.RegionIds.Count < 2)
            {
                throw new ArgumentException("Hazard Undercroft must span at least two regions.", nameof(Districts));
            }

            var assigned = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonBiomeDistrictPlanV2 district in Districts)
            {
                foreach (string regionId in district.RegionIds)
                {
                    DungeonRegionPlanV2 region = RequireReference(
                        Regions,
                        regionId,
                        value => value.Id,
                        nameof(Districts));
                    RequireEqual(district.Id, region.BiomeDistrictId, "District/region ownership mismatch.", nameof(Districts));
                    if (!assigned.Add(regionId))
                    {
                        throw new ArgumentException("A region may belong to only one district.", nameof(Districts));
                    }
                }

                foreach (string controllerId in district.EnvironmentControllerIds)
                {
                    RequireReference(EnvironmentControllers, controllerId, value => value.Id, nameof(Districts));
                }

                foreach (string transitionId in district.EntranceTransitionIds)
                {
                    RequireReference(TraversalEdges, transitionId, value => value.Id, nameof(Districts));
                }

                foreach (string anchorId in district.RevealAnchorIds)
                {
                    RequireReference(Anchors, anchorId, value => value.Id, nameof(Districts));
                }
            }

            if (assigned.Count != Regions.Count)
            {
                throw new ArgumentException("District membership must cover every region exactly once.", nameof(Districts));
            }

            RequireDistinctModuleCount(factory.RegionIds, 1, nameof(Districts));
            RequireDistinctModuleCount(waterworks.RegionIds, 3, nameof(Districts));
            // A Hazard Undercroft may be one authored multi-region vertical
            // composition or a socket-connected subgraph. Region-count and
            // certified-portal validation prove the former without inventing
            // two fixed macro-room instances.
            RequireDistinctModuleCount(hazard.RegionIds, 1, nameof(Districts));
        }

        private void ValidateModulesRegionsAnchors()
        {
            foreach (DungeonModuleInstancePlanV2 module in Modules)
            {
                DungeonMacroRolePlanV2 macro = RequireReference(
                    MacroRoles,
                    module.MacroRoleId,
                    value => value.Id,
                    nameof(Modules));
                RequireContains(macro.ModuleInstanceIds, module.Id, "Macro must list owned module.", nameof(Modules));
                RequireBoundsContains(Bounds, module.Bounds, nameof(Modules));

                foreach (string regionId in module.RegionIds)
                {
                    DungeonRegionPlanV2 region = RequireReference(Regions, regionId, value => value.Id, nameof(Modules));
                    RequireEqual(module.MacroRoleId, region.MacroRoleId, "Module/region macro mismatch.", nameof(Modules));
                    RequireContains(region.ModuleInstanceIds, module.Id, "Region must list containing module.", nameof(Modules));
                }

                foreach (string connectorId in module.ConnectorIds)
                {
                    DungeonModuleConnectorPlanV2 connector = RequireReference(
                        Connectors,
                        connectorId,
                        value => value.Id,
                        nameof(Modules));
                    RequireEqual(module.Id, connector.ModuleInstanceId, "Module/connector ownership mismatch.", nameof(Modules));
                }

                foreach (string anchorId in module.AnchorIds)
                {
                    DungeonAnchorPlanV2 anchor = RequireReference(Anchors, anchorId, value => value.Id, nameof(Modules));
                    RequireEqual(module.Id, anchor.ModuleInstanceId, "Module/anchor ownership mismatch.", nameof(Modules));
                }
            }

            foreach (DungeonRegionPlanV2 region in Regions)
            {
                RequireReference(MacroRoles, region.MacroRoleId, value => value.Id, nameof(Regions));
                RequireReference(Districts, region.BiomeDistrictId, value => value.Id, nameof(Regions));
                RequireBoundsContains(Bounds, region.Bounds, nameof(Regions));
                foreach (string moduleId in region.ModuleInstanceIds)
                {
                    DungeonModuleInstancePlanV2 module = RequireReference(Modules, moduleId, value => value.Id, nameof(Regions));
                    RequireContains(module.RegionIds, region.Id, "Module must list owned region.", nameof(Regions));
                }

                ValidateRegionAnchors(region, region.EntryExitAnchorIds, DungeonAnchorKindV2.Entry, DungeonAnchorKindV2.Exit);
                ValidateRegionAnchors(region, region.EncounterAnchorIds, DungeonAnchorKindV2.Encounter);
                ValidateRegionAnchors(region, region.RewardAnchorIds, DungeonAnchorKindV2.Reward);
                ValidateRegionAnchors(region, region.ConsoleAnchorIds, DungeonAnchorKindV2.Console);
                ValidateRegionAnchors(region, region.LandmarkAnchorIds, DungeonAnchorKindV2.Landmark);
            }

            foreach (DungeonModuleConnectorPlanV2 connector in Connectors)
            {
                DungeonModuleInstancePlanV2 module = RequireReference(
                    Modules,
                    connector.ModuleInstanceId,
                    value => value.Id,
                    nameof(Connectors));
                DungeonRegionPlanV2 region = RequireReference(
                    Regions,
                    connector.RegionId,
                    value => value.Id,
                    nameof(Connectors));
                RequireContains(module.ConnectorIds, connector.Id, "Module must list connector.", nameof(Connectors));
                RequireContains(module.RegionIds, region.Id, "Connector module must own its region.", nameof(Connectors));
            }

            foreach (DungeonAnchorPlanV2 anchor in Anchors)
            {
                DungeonModuleInstancePlanV2 module = RequireReference(
                    Modules,
                    anchor.ModuleInstanceId,
                    value => value.Id,
                    nameof(Anchors));
                DungeonRegionPlanV2 region = RequireReference(Regions, anchor.RegionId, value => value.Id, nameof(Anchors));
                RequireContains(module.AnchorIds, anchor.Id, "Module must list anchor.", nameof(Anchors));
                RequireContains(region.ModuleInstanceIds, module.Id, "Anchor module must contribute to its region.", nameof(Anchors));
                if (!Bounds.Contains(anchor.Position))
                {
                    throw new ArgumentException("Anchor lies outside plan bounds: " + anchor.Id, nameof(Anchors));
                }
            }
        }

        private void ValidateTraversalAndDiscoveries()
        {
            foreach (DungeonTraversalEdgePlanV2 edge in TraversalEdges)
            {
                RequireReference(Regions, edge.FromRegionId, value => value.Id, nameof(TraversalEdges));
                RequireReference(Regions, edge.ToRegionId, value => value.Id, nameof(TraversalEdges));
                DungeonAnchorPlanV2 from = RequireReference(Anchors, edge.FromAnchorId, value => value.Id, nameof(TraversalEdges));
                DungeonAnchorPlanV2 to = RequireReference(Anchors, edge.ToAnchorId, value => value.Id, nameof(TraversalEdges));
                RequireEqual(edge.FromRegionId, from.RegionId, "Traversal from-anchor region mismatch.", nameof(TraversalEdges));
                RequireEqual(edge.ToRegionId, to.RegionId, "Traversal to-anchor region mismatch.", nameof(TraversalEdges));
            }

            foreach (DungeonExplorationRoutePlanV2 route in Routes)
            {
                DungeonTraversalEdgePlanV2 previous = null;
                foreach (string edgeId in route.OrderedTraversalEdgeIds)
                {
                    DungeonTraversalEdgePlanV2 edge = RequireReference(
                        TraversalEdges,
                        edgeId,
                        value => value.Id,
                        nameof(Routes));
                    if (previous != null
                        && !string.Equals(previous.ToRegionId, edge.FromRegionId, StringComparison.Ordinal))
                    {
                        throw new ArgumentException("Ordered route edges must form a continuous directed path.", nameof(Routes));
                    }

                    previous = edge;
                }

                foreach (string discoveryId in route.DiscoveryIds)
                {
                    RequireReference(Discoveries, discoveryId, value => value.Id, nameof(Routes));
                }

                foreach (DungeonAuthorizedExitPlanV2 exit in route.AuthorizedExits)
                {
                    RequireReference(Regions, exit.ExitRegionId, value => value.Id, nameof(Routes));
                    RequireReference(Regions, exit.RejoinRegionId, value => value.Id, nameof(Routes));
                }
            }

            foreach (DungeonDiscoveryPlanV2 discovery in Discoveries)
            {
                DungeonAnchorPlanV2 anchor = RequireReference(
                    Anchors,
                    discovery.LocationAnchorId,
                    value => value.Id,
                    nameof(Discoveries));
                DungeonBiomeDistrictPlanV2 district = RequireReference(
                    Districts,
                    discovery.DistrictId,
                    value => value.Id,
                    nameof(Discoveries));
                DungeonRegionPlanV2 region = RequireReference(Regions, anchor.RegionId, value => value.Id, nameof(Discoveries));
                RequireEqual(district.Id, region.BiomeDistrictId, "Discovery district does not own its anchor region.", nameof(Discoveries));
            }

            foreach (DungeonShortcutPlanV2 shortcut in Shortcuts)
            {
                RequireReference(Routes, shortcut.RouteId, value => value.Id, nameof(Shortcuts));
                RequireReference(Regions, shortcut.ActivationRegionId, value => value.Id, nameof(Shortcuts));
                RequireReference(Regions, shortcut.RejoinRegionId, value => value.Id, nameof(Shortcuts));
                DungeonAnchorPlanV2 activation = RequireReference(
                    Anchors,
                    shortcut.ActivationAnchorId,
                    value => value.Id,
                    nameof(Shortcuts));
                RequireEqual(shortcut.ActivationRegionId, activation.RegionId, "Shortcut activation anchor mismatch.", nameof(Shortcuts));
                foreach (string edgeId in shortcut.LockedTraversalEdgeIds)
                {
                    RequireReference(TraversalEdges, edgeId, value => value.Id, nameof(Shortcuts));
                }

                foreach (string edgeId in shortcut.UnlockedTraversalEdgeIds)
                {
                    RequireReference(TraversalEdges, edgeId, value => value.Id, nameof(Shortcuts));
                }
            }
        }

        private void ValidateEnvironment()
        {
            foreach (DungeonSurfacePlanV2 surface in Surfaces)
            {
                DungeonModuleInstancePlanV2 module = RequireReference(
                    Modules,
                    surface.ModuleInstanceId,
                    value => value.Id,
                    nameof(Surfaces));
                DungeonRegionPlanV2 region = RequireReference(Regions, surface.RegionId, value => value.Id, nameof(Surfaces));
                RequireContains(region.ModuleInstanceIds, module.Id, "Surface module must contribute to surface region.", nameof(Surfaces));
                if (surface.ControllerId != null)
                {
                    RequireReference(EnvironmentControllers, surface.ControllerId, value => value.Id, nameof(Surfaces));
                }
            }

            foreach (DungeonEnvironmentControllerPlanV2 controller in EnvironmentControllers)
            {
                foreach (string regionId in controller.RegionIds)
                {
                    RequireReference(Regions, regionId, value => value.Id, nameof(EnvironmentControllers));
                }
            }

            foreach (DungeonFluidNetworkPlanV2 network in FluidNetworks)
            {
                foreach (string regionId in network.RegionIds)
                {
                    RequireReference(Regions, regionId, value => value.Id, nameof(FluidNetworks));
                }

                foreach (string controllerId in network.ControllerIds)
                {
                    RequireReference(EnvironmentControllers, controllerId, value => value.Id, nameof(FluidNetworks));
                }

                foreach (string zoneId in network.FluidZoneIds)
                {
                    DungeonFluidZonePlanV2 zone = RequireReference(FluidZones, zoneId, value => value.Id, nameof(FluidNetworks));
                    RequireEqual(network.Id, zone.FluidNetworkId, "Fluid network/zone ownership mismatch.", nameof(FluidNetworks));
                    RequireContains(network.RegionIds, zone.RegionId, "Fluid network must list every zone region.", nameof(FluidNetworks));
                }

                foreach (DungeonFluidConfigurationPlanV2 configuration in network.StableConfigurations)
                {
                    foreach (string zoneId in configuration.ActiveFluidZoneIds)
                    {
                        RequireContains(network.FluidZoneIds, zoneId, "Fluid configuration references a foreign zone.", nameof(FluidNetworks));
                    }
                }
            }

            foreach (DungeonFluidZonePlanV2 zone in FluidZones)
            {
                DungeonFluidNetworkPlanV2 network = RequireReference(
                    FluidNetworks,
                    zone.FluidNetworkId,
                    value => value.Id,
                    nameof(FluidZones));
                RequireReference(Regions, zone.RegionId, value => value.Id, nameof(FluidZones));
                RequireReference(Surfaces, zone.FloorSurfaceId, value => value.Id, nameof(FluidZones));
                RequireContains(network.FluidZoneIds, zone.Id, "Fluid network must list owned zone.", nameof(FluidZones));
                foreach (string configurationId in zone.ActiveConfigurationIds)
                {
                    RequireReference(network.StableConfigurations, configurationId, value => value.Id, nameof(FluidZones));
                }
            }
        }

        private void ValidateFallContracts()
        {
            foreach (DungeonFallExposurePlanV2 exposure in FallExposures)
            {
                RequireReference(Regions, exposure.SourceRegionId, value => value.Id, nameof(FallExposures));
                DungeonSurfacePlanV2 sourceSurface = RequireReference(
                    Surfaces,
                    exposure.SourceSurfaceId,
                    value => value.Id,
                    nameof(FallExposures));
                RequireEqual(
                    exposure.SourceRegionId,
                    sourceSurface.RegionId,
                    "Fall exposure source-surface region mismatch.",
                    nameof(FallExposures));
                foreach (string railId in exposure.RailConstraintSurfaceIds)
                {
                    RequireReference(Surfaces, railId, value => value.Id, nameof(FallExposures));
                }

                foreach (string catchmentId in exposure.RequiredCatchmentIds)
                {
                    DungeonFallCatchmentPlanV2 catchment = RequireReference(
                        FallCatchments,
                        catchmentId,
                        value => value.Id,
                        nameof(FallExposures));
                    RequireContains(catchment.CoveredExposureIds, exposure.Id, "Catchment must list covered exposure.", nameof(FallExposures));
                }
            }

            foreach (DungeonFallCatchmentPlanV2 catchment in FallCatchments)
            {
                RequireReference(Regions, catchment.RegionId, value => value.Id, nameof(FallCatchments));
                DungeonAnchorPlanV2 anchor = RequireReference(Anchors, catchment.SafeAnchorId, value => value.Id, nameof(FallCatchments));
                RequireEqual(catchment.RegionId, anchor.RegionId, "Catchment safe anchor region mismatch.", nameof(FallCatchments));
                foreach (string surfaceId in catchment.SafeSurfaceIds)
                {
                    DungeonSurfacePlanV2 surface = RequireReference(
                        Surfaces,
                        surfaceId,
                        value => value.Id,
                        nameof(FallCatchments));
                    RequireEqual(
                        catchment.RegionId,
                        surface.RegionId,
                        "Catchment safe-surface region mismatch.",
                        nameof(FallCatchments));
                }

                foreach (string exposureId in catchment.CoveredExposureIds)
                {
                    DungeonFallExposurePlanV2 exposure = RequireReference(
                        FallExposures,
                        exposureId,
                        value => value.Id,
                        nameof(FallCatchments));
                    RequireContains(exposure.RequiredCatchmentIds, catchment.Id, "Exposure must list required catchment.", nameof(FallCatchments));
                }
            }
        }

        private DungeonBiomeDistrictPlanV2 SingleDistrict(DungeonBiomeDistrictKindV2 kind)
        {
            DungeonBiomeDistrictPlanV2 result = null;
            foreach (DungeonBiomeDistrictPlanV2 district in Districts)
            {
                if (district.Kind != kind)
                {
                    continue;
                }

                if (result != null)
                {
                    throw new ArgumentException("District kind may appear only once: " + kind, nameof(Districts));
                }

                result = district;
            }

            if (result == null)
            {
                throw new ArgumentException("Missing district kind: " + kind, nameof(Districts));
            }

            return result;
        }

        private int CountDistricts(DungeonBiomeDistrictKindV2 kind)
        {
            int count = 0;
            foreach (DungeonBiomeDistrictPlanV2 district in Districts)
            {
                if (district.Kind == kind)
                {
                    count += 1;
                }
            }

            return count;
        }

        private void RequireDistinctModuleCount(IEnumerable<string> regionIds, int minimum, string parameterName)
        {
            var moduleIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (string regionId in regionIds)
            {
                DungeonRegionPlanV2 region = RequireReference(Regions, regionId, value => value.Id, parameterName);
                foreach (string moduleId in region.ModuleInstanceIds)
                    moduleIds.Add(moduleId);
            }

            if (moduleIds.Count < minimum)
            {
                throw new ArgumentException("District spans fewer authored modules than required.", parameterName);
            }
        }

        private void ValidateRegionAnchors(
            DungeonRegionPlanV2 region,
            IEnumerable<string> anchorIds,
            params DungeonAnchorKindV2[] allowedKinds)
        {
            foreach (string anchorId in anchorIds)
            {
                DungeonAnchorPlanV2 anchor = RequireReference(Anchors, anchorId, value => value.Id, nameof(Regions));
                RequireEqual(region.Id, anchor.RegionId, "Region anchor ownership mismatch.", nameof(Regions));
                bool kindAllowed = false;
                foreach (DungeonAnchorKindV2 allowed in allowedKinds)
                {
                    kindAllowed |= anchor.Kind == allowed;
                }

                if (!kindAllowed)
                {
                    throw new ArgumentException("Region anchor has the wrong semantic kind: " + anchor.Id, nameof(Regions));
                }
            }
        }

        private string BuildDeterministicSignature()
        {
            var writer = new DungeonV2SignatureWriter();
            writer.Add(SchemaVersion);
            writer.Add(ContractVersion);
            writer.Add(RulesetVersion);
            writer.Add(ProfileId);
            writer.Add(ContentPackVersion);
            writer.Add(Seed);
            writer.Add(AttemptSeed);
            writer.Add(GenerationAttempt);
            writer.Add(Difficulty);
            writer.Add(EntranceRegionId);
            writer.Add(ExtractionRegionId);
            writer.Add(Bounds.Minimum);
            writer.Add(Bounds.Maximum);
            writer.Add((int)VoidPolicy);
            AddIds(writer, MacroRoles, value => value.Id);
            foreach (DungeonMacroRolePlanV2 macro in MacroRoles)
            {
                writer.Add((int)macro.Role);
                AddStrings(writer, macro.ModuleInstanceIds);
            }

            AddIds(writer, GameplayBeats, value => value.Id);
            foreach (DungeonGameplayBeatPlanV2 beat in GameplayBeats)
            {
                writer.Add((int)beat.Kind);
                AddStrings(writer, beat.PrerequisiteBeatIds);
            }

            AddIds(writer, AbstractRouteGraph.Nodes, value => value.Id);
            foreach (DungeonAbstractRouteNodeV2 node in AbstractRouteGraph.Nodes)
            {
                writer.Add((int)node.District);
                writer.Add(node.TransitionOnly);
            }
            AddIds(writer, AbstractRouteGraph.Edges, value => value.Id);
            foreach (DungeonAbstractRouteEdgeV2 edge in AbstractRouteGraph.Edges)
            {
                writer.Add(edge.FromNodeId);
                writer.Add(edge.ToNodeId);
                writer.Add((int)edge.Role);
                writer.Add(edge.Bidirectional);
                writer.Add(edge.FromConnectorId);
                writer.Add(edge.ToConnectorId);
            }

            AddIds(writer, BeatAssignments, value => value.BeatId);
            foreach (DungeonGameplayBeatAssignmentV2 assignment in BeatAssignments)
                AddStrings(writer, assignment.ModuleInstanceIds);

            AddIds(writer, MiniDungeonCompositions, value => value.Id);
            foreach (DungeonMiniDungeonCompositionGrammarV2 composition in MiniDungeonCompositions)
            {
                AddStrings(writer, composition.ModuleInstanceIds);
                AddStrings(writer, composition.RouteDecisionNodeIds);
                writer.Add(composition.EntryNodeId);
                writer.Add(composition.CriticalExitNodeId);
                writer.Add(composition.MechanismTargetId);
                writer.Add((int)composition.MechanismKind);
                writer.Add(composition.VerticalMechanism);
                writer.Add(composition.RewardBranchNodeId);
                writer.Add(composition.LoopOrRejoinEdgeId);
            }

            AddIds(writer, Modules, value => value.Id);
            foreach (DungeonModuleInstancePlanV2 module in Modules)
            {
                writer.Add(module.TemplateId);
                writer.Add(module.ContentHash);
                writer.Add(module.MacroRoleId);
                writer.Add(module.Bounds.Minimum);
                writer.Add(module.Bounds.Maximum);
                writer.Add(module.Transform.Translation);
                writer.Add(module.Transform.QuarterTurns);
                writer.Add(module.VerticalCompositionId);
                AddStrings(writer, module.VerticalPortalConnectorIds);
                AddStrings(writer, module.RegionIds);
                writer.Add(module.RegionBindings.Count);
                foreach (DungeonModuleRegionBindingV2 binding in module.RegionBindings)
                {
                    writer.Add(binding.LocalRegionId);
                    writer.Add(binding.PlacedRegionId);
                }
                AddStrings(writer, module.ConnectorIds);
                AddStrings(writer, module.AnchorIds);
            }

            AddIds(writer, Regions, value => value.Id);
            foreach (DungeonRegionPlanV2 region in Regions)
            {
                writer.Add((int)region.Source);
                writer.Add(region.MacroRoleId);
                writer.Add(region.BiomeDistrictId);
                writer.Add((int)region.ElevationStratum);
                writer.Add(region.Bounds.Minimum);
                writer.Add(region.Bounds.Maximum);
                writer.Add(region.LocalNavigationRegionId);
                AddStrings(writer, region.ModuleInstanceIds);
                AddStrings(writer, region.EntryExitAnchorIds);
                AddStrings(writer, region.EncounterAnchorIds);
                AddStrings(writer, region.RewardAnchorIds);
                AddStrings(writer, region.ConsoleAnchorIds);
                AddStrings(writer, region.LandmarkAnchorIds);
                writer.Add(region.SupportedEnvironmentStates.Count);
                foreach (DungeonEnvironmentSupportPlanV2 state in region.SupportedEnvironmentStates)
                {
                    writer.Add(state.Id);
                    AddPredicate(writer, state.Predicate);
                }
            }

            AddIds(writer, Districts, value => value.Id);
            foreach (DungeonBiomeDistrictPlanV2 district in Districts)
            {
                writer.Add((int)district.Kind);
                AddStrings(writer, district.RegionIds);
                AddStrings(writer, district.EntranceTransitionIds);
                AddStrings(writer, district.RevealAnchorIds);
                AddStrings(writer, district.TraversalTags);
                AddStrings(writer, district.EncounterCompatibilityTags);
                writer.Add(district.LandmarkProfileId);
                writer.Add(district.RewardProfileId);
                writer.Add(district.AudioProfileId);
                writer.Add(district.LightingProfileId);
                writer.Add(district.MinimapPresentationProfileId);
                writer.Add(district.MinimumDiscoveries);
                writer.Add(district.MinimumRouteLoops);
                writer.Add(district.MinimumReturnConnections);
                AddStrings(writer, district.EnvironmentControllerIds);
            }

            AddIds(writer, Connectors, value => value.Id);
            foreach (DungeonModuleConnectorPlanV2 connector in Connectors)
            {
                writer.Add((int)connector.Source);
                writer.Add(connector.ModuleInstanceId);
                writer.Add(connector.RegionId);
                writer.Add((int)connector.Kind);
                writer.Add(connector.Position);
                writer.Add(connector.Facing);
                writer.Add(connector.SocketTag);
                writer.Add(connector.Aperture != null);
                if (connector.Aperture != null)
                {
                    writer.Add(connector.Aperture.LocalVolume);
                    writer.Add(connector.Aperture.SocketProfileId);
                    writer.Add(connector.Aperture.ThemedCapProfileId);
                    writer.Add(connector.Aperture.FloorElevation);
                    writer.Add(connector.Aperture.FloorSlopeDegrees);
                    writer.Add(connector.Aperture.PlayerClearanceVolume);
                    writer.Add(connector.Aperture.CameraClearanceVolume);
                    writer.Add(connector.Aperture.SeamDepth);
                    writer.Add(connector.Aperture.ApproachVolume);
                    writer.Add(connector.Aperture.NavigationHandoffProfileId);
                    writer.Add((int)connector.Aperture.CapState);
                    writer.Add(connector.Aperture.MechanismBindingId);
                    writer.Add(connector.Aperture.ExteriorGasketProfileId);
                    writer.Add(connector.Aperture.VerticalCompositionPortalId);
                    writer.Add(connector.Aperture.CompatibleConnectorKinds.Count);
                    foreach (DungeonConnectorKindV2 kind in connector.Aperture.CompatibleConnectorKinds)
                        writer.Add((int)kind);
                }
                AddPredicate(writer, connector.AccessPredicate);
            }

            AddIds(writer, Anchors, value => value.Id);
            foreach (DungeonAnchorPlanV2 anchor in Anchors)
            {
                writer.Add((int)anchor.Source);
                writer.Add(anchor.ModuleInstanceId);
                writer.Add(anchor.RegionId);
                writer.Add((int)anchor.Kind);
                writer.Add(anchor.Position);
                writer.Add(anchor.ProfileId);
            }

            AddIds(writer, TraversalEdges, value => value.Id);
            foreach (DungeonTraversalEdgePlanV2 edge in TraversalEdges)
            {
                writer.Add(edge.FromRegionId);
                writer.Add(edge.ToRegionId);
                writer.Add(edge.FromAnchorId);
                writer.Add(edge.ToAnchorId);
                writer.Add((int)edge.Kind);
                AddPredicate(writer, edge.AccessPredicate);
                writer.Add(edge.IsProtectedProgressionBoundary);
            }

            AddIds(writer, Routes, value => value.Id);
            foreach (DungeonExplorationRoutePlanV2 route in Routes)
            {
                AddStrings(writer, route.OrderedTraversalEdgeIds);
                writer.Add((int)route.Role);
                AddPredicate(writer, route.RequiredPredicate);
                writer.Add(route.AuthorizedExits.Count);
                foreach (DungeonAuthorizedExitPlanV2 exit in route.AuthorizedExits)
                {
                    writer.Add(exit.Id);
                    writer.Add(exit.ExitRegionId);
                    writer.Add(exit.RejoinRegionId);
                    AddPredicate(writer, exit.EarliestAuthorizationPredicate);
                }

                writer.Add(route.EstimatedTraversalSeconds);
                writer.Add(route.RiskBudget);
                AddStrings(writer, route.DiscoveryIds);
                writer.Add((int)route.ReverseTraversalPolicy);
                writer.Add((int)route.RevealPolicy);
            }

            AddIds(writer, Discoveries, value => value.Id);
            foreach (DungeonDiscoveryPlanV2 discovery in Discoveries)
            {
                writer.Add((int)discovery.Kind);
                writer.Add(discovery.LocationAnchorId);
                writer.Add(discovery.DistrictId);
                AddPredicate(writer, discovery.AccessPredicate);
                AddPredicate(writer, discovery.RevealPredicate);
                writer.Add(discovery.DurableRewardId);
                writer.Add(discovery.CompletionSignificance);
                writer.Add((int)discovery.DuplicatePolicy);
            }

            AddIds(writer, Shortcuts, value => value.Id);
            foreach (DungeonShortcutPlanV2 shortcut in Shortcuts)
            {
                writer.Add(shortcut.RouteId);
                AddStrings(writer, shortcut.LockedTraversalEdgeIds);
                AddStrings(writer, shortcut.UnlockedTraversalEdgeIds);
                writer.Add(shortcut.ActivationRegionId);
                writer.Add(shortcut.ActivationAnchorId);
                AddPredicate(writer, shortcut.EarliestAuthorizationPredicate);
                writer.Add(shortcut.RejoinRegionId);
                AddPredicate(writer, shortcut.EnvironmentStatePredicate);
                writer.Add((int)shortcut.PersistencePolicy);
                writer.Add((int)shortcut.RevealPolicy);
            }

            AddIds(writer, Surfaces, value => value.Id);
            foreach (DungeonSurfacePlanV2 surface in Surfaces)
            {
                writer.Add((int)surface.Source);
                writer.Add(surface.ModuleInstanceId);
                writer.Add(surface.RegionId);
                writer.Add((int)surface.Kind);
                AddPrism(writer, surface.Volume);
                writer.Add(surface.MaterialProfileId);
                writer.Add(surface.IsStructural);
                writer.Add(surface.IsWalkable);
                AddPredicate(writer, surface.ActivePredicate);
                writer.Add(surface.ControllerId);
            }

            AddIds(writer, FluidZones, value => value.Id);
            foreach (DungeonFluidZonePlanV2 zone in FluidZones)
            {
                writer.Add((int)zone.Kind);
                writer.Add(zone.FluidNetworkId);
                writer.Add(zone.RegionId);
                AddPrism(writer, zone.Volume);
                writer.Add(zone.FloorSurfaceId);
                AddStrings(writer, zone.ActiveConfigurationIds);
                writer.Add(zone.MinimumCushioningDepth);
            }

            AddIds(writer, FluidNetworks, value => value.Id);
            foreach (DungeonFluidNetworkPlanV2 network in FluidNetworks)
            {
                AddStrings(writer, network.RegionIds);
                AddStrings(writer, network.FluidZoneIds);
                writer.Add(network.StableConfigurations.Count);
                foreach (DungeonFluidConfigurationPlanV2 configuration in network.StableConfigurations)
                {
                    writer.Add(configuration.Id);
                    AddStrings(writer, configuration.ActiveFluidZoneIds);
                }

                writer.Add(network.InitialConfigurationId);
                AddStrings(writer, network.ControllerIds);
            }

            AddIds(writer, EnvironmentControllers, value => value.Id);
            foreach (DungeonEnvironmentControllerPlanV2 controller in EnvironmentControllers)
            {
                writer.Add((int)controller.Kind);
                AddStrings(writer, controller.RegionIds);
                AddStrings(writer, controller.StableStateIds);
                writer.Add(controller.InitialStateId);
                writer.Add(controller.Transitions.Count);
                foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
                {
                    writer.Add(transition.Id);
                    writer.Add(transition.FromStateId);
                    writer.Add(transition.ToStateId);
                    writer.Add(transition.PresentationSeconds);
                    AddPredicate(writer, transition.ActivationPredicate);
                    writer.Add(transition.CommitsAtomically);
                }
            }

            AddIds(writer, FallCatchments, value => value.Id);
            foreach (DungeonFallCatchmentPlanV2 catchment in FallCatchments)
            {
                writer.Add((int)catchment.Kind);
                writer.Add(catchment.RegionId);
                AddPrism(writer, catchment.Volume);
                AddStrings(writer, catchment.SafeSurfaceIds);
                writer.Add(catchment.SafeAnchorId);
                AddStrings(writer, catchment.CoveredExposureIds);
                writer.Add(catchment.StructuralBottomY);
            }

            AddIds(writer, FallExposures, value => value.Id);
            foreach (DungeonFallExposurePlanV2 exposure in FallExposures)
            {
                writer.Add(exposure.SourceRegionId);
                writer.Add(exposure.SourceSurfaceId);
                AddPrism(writer, exposure.SourceVolume);
                writer.Add((int)exposure.Causes);
                writer.Add(exposure.MovementProfileVersion);
                writer.Add(exposure.MaximumHorizontalDisplacement);
                AddPrism(writer, exposure.ConservativeFallVolume);
                AddStrings(writer, exposure.RailConstraintSurfaceIds);
                AddStrings(writer, exposure.RequiredCatchmentIds);
                writer.Add(exposure.StructuralBottomClearance);
                writer.Add(exposure.ReactionEnvelopeId);
            }

            return writer.ToString();
        }

        private static void AddPredicate(DungeonV2SignatureWriter writer, DungeonAccessPredicateV2 predicate)
        {
            writer.Add(predicate.Clauses.Count);
            foreach (DungeonPredicateClauseV2 clause in predicate.Clauses)
            {
                writer.Add(clause.Conditions.Count);
                foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                {
                    writer.Add((int)condition.Kind);
                    writer.Add(condition.SubjectId);
                    writer.Add((int)condition.Operator);
                    writer.Add(condition.ExpectedValue);
                }
            }
        }

        private static void AddPrism(DungeonV2SignatureWriter writer, DungeonConvexPrismV2 prism)
        {
            writer.Add(prism.HorizontalVertices.Count);
            foreach (DungeonPoint2V2 vertex in prism.HorizontalVertices)
            {
                writer.Add(vertex.X);
                writer.Add(vertex.Z);
            }

            writer.Add(prism.MinimumY);
            writer.Add(prism.MaximumY);
        }

        private static void AddIds<T>(DungeonV2SignatureWriter writer, IReadOnlyList<T> values, Func<T, string> selector)
        {
            writer.Add(values.Count);
            foreach (T value in values)
            {
                writer.Add(selector(value));
            }
        }

        private static void AddStrings(DungeonV2SignatureWriter writer, IReadOnlyList<string> values)
        {
            writer.Add(values.Count);
            foreach (string value in values)
            {
                writer.Add(value);
            }
        }

        private static void RequireCount(int actual, int expected, string parameterName)
        {
            if (actual != expected)
            {
                throw new ArgumentException("Expected " + expected + " entries but received " + actual + ".", parameterName);
            }
        }

        private static T RequireReference<T>(
            IReadOnlyList<T> values,
            string id,
            Func<T, string> idSelector,
            string parameterName)
        {
            foreach (T value in values)
            {
                if (string.Equals(idSelector(value), id, StringComparison.Ordinal))
                {
                    return value;
                }
            }

            throw new ArgumentException("Unknown referenced stable ID: " + id, parameterName);
        }

        private static void RequireContains(
            IReadOnlyList<string> ids,
            string target,
            string message,
            string parameterName)
        {
            foreach (string id in ids)
            {
                if (string.Equals(id, target, StringComparison.Ordinal))
                {
                    return;
                }
            }

            throw new ArgumentException(message + " Missing: " + target, parameterName);
        }

        private static void RequireEqual(string expected, string actual, string message, string parameterName)
        {
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                throw new ArgumentException(message + " Expected " + expected + ", received " + actual + ".", parameterName);
            }
        }

        private static void RequireBoundsContains(DungeonBounds3 outer, DungeonBounds3 inner, string parameterName)
        {
            if (!outer.Contains(inner.Minimum) || !outer.Contains(inner.Maximum))
            {
                throw new ArgumentException("Child bounds lie outside the dungeon plan bounds.", parameterName);
            }
        }
    }

    internal sealed class DungeonV2SignatureWriter
    {
        private readonly StringBuilder builder = new StringBuilder(4096);

        public void Add(string value)
        {
            if (value == null)
            {
                builder.Append("-1:|");
                return;
            }

            builder.Append(value.Length).Append(':').Append(value).Append('|');
        }

        public void Add(int value) => builder.Append(value.ToString(CultureInfo.InvariantCulture)).Append('|');

        public void Add(bool value) => builder.Append(value ? '1' : '0').Append('|');

        public void Add(double value)
        {
            builder.Append(value.ToString("R", CultureInfo.InvariantCulture)).Append('|');
        }

        public void Add(DungeonPoint3 point)
        {
            Add(point.X);
            Add(point.Y);
            Add(point.Z);
        }

        public void Add(DungeonConvexPrismV2 prism)
        {
            if (prism == null)
            {
                Add(-1);
                return;
            }
            Add(prism.HorizontalVertices.Count);
            foreach (DungeonPoint2V2 point in prism.HorizontalVertices)
            {
                Add(point.X);
                Add(point.Z);
            }
            Add(prism.MinimumY);
            Add(prism.MaximumY);
        }

        public override string ToString() => builder.ToString();
    }
}
