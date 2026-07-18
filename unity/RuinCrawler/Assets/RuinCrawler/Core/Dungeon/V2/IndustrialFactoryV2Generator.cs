using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Constructive deterministic generator for the first industrial-factory-v2
    /// golden slice. It produces complete source plans without Unity references.
    /// </summary>
    public sealed class IndustrialFactoryV2Generator
    {
        private static readonly string[] FactoryRegionIds =
        {
            "factory-security-entrance",
            "factory-assembly-floor",
            "factory-broken-freight-shaft",
            "factory-sorting-gantry",
            "factory-nest-warehouse",
            "factory-credential-tower",
            "factory-machine-core"
        };

        private readonly IIndustrialFactoryV2ModuleCatalog moduleCatalog;
        private readonly IIndustrialFactoryV2CandidateValidator validator;

        public IndustrialFactoryV2Generator(IIndustrialFactoryV2CandidateValidator validator = null)
            : this(IndustrialFactoryV2ModuleCatalog.Default, validator)
        {
        }

        public IndustrialFactoryV2Generator(
            IIndustrialFactoryV2ModuleCatalog moduleCatalog,
            IIndustrialFactoryV2CandidateValidator validator = null)
        {
            this.moduleCatalog = moduleCatalog ?? throw new ArgumentNullException(nameof(moduleCatalog));
            this.validator = validator ?? new IndustrialFactoryV2Validator(this.moduleCatalog);
        }

        public DungeonPlanV2 Generate(string seed, int difficulty = 1)
        {
            IndustrialFactoryV2GenerationResult result = GenerateResult(
                seed,
                new IndustrialFactoryV2GenerationOptions(difficulty));
            if (result.Succeeded) return result.Plan;

            throw new InvalidOperationException(
                "Constructive industrial-factory-v2 generation exhausted "
                    + result.Failure.Attempts + " deterministic attempts: "
                    + string.Join(" | ", result.Failure.LastErrors.Select(error => error.ToString())));
        }

        public IndustrialFactoryV2GenerationResult GenerateResult(
            string seed,
            IndustrialFactoryV2GenerationOptions options = null)
        {
            string normalizedSeed = string.IsNullOrWhiteSpace(seed) ? "industrial-factory-v2" : seed.Trim();
            IndustrialFactoryV2GenerationOptions resolved = options ?? new IndustrialFactoryV2GenerationOptions();
            DungeonBiomeDistrictKindV2 hazardKind = (DungeonDeterministicRandom.HashSeed(normalizedSeed) & 1u) == 0u
                ? DungeonBiomeDistrictKindV2.MagmaUndercroft
                : DungeonBiomeDistrictKindV2.ElectricalUndercroft;
            var reports = new List<IndustrialFactoryV2GenerationAttemptReport>();
            IndustrialFactoryV2ValidationResult lastValidation = new IndustrialFactoryV2ValidationResult(
                new[]
                {
                    new IndustrialFactoryV2ValidationIssue(
                        "NO_CANDIDATE_EVALUATED",
                        "/generation",
                        "No constructive V2 candidate was evaluated.")
                });

            for (int attempt = 1; attempt <= resolved.MaximumAttempts; attempt += 1)
            {
                string attemptSeed = normalizedSeed + ":attempt:" + attempt;
                var context = new IndustrialFactoryV2GenerationContext(
                    normalizedSeed,
                    attemptSeed,
                    attempt,
                    resolved.Difficulty);
                var search = new AttemptSearchState(context, hazardKind, resolved.MaximumBacktracksPerAttempt);
                bool accepted = SearchAuthoredCandidates(search);
                lastValidation = search.LastValidation ?? lastValidation;
                reports.Add(new IndustrialFactoryV2GenerationAttemptReport(
                    attempt,
                    attemptSeed,
                    search.CandidateCount,
                    search.BacktrackCount,
                    lastValidation));
                if (accepted)
                {
                    return IndustrialFactoryV2GenerationResult.Success(search.AcceptedPlan, reports);
                }
            }

            return IndustrialFactoryV2GenerationResult.Failed(
                new IndustrialFactoryV2GenerationFailure(
                    normalizedSeed,
                    reports.Count,
                    lastValidation.Errors),
                reports);
        }

        private bool SearchAuthoredCandidates(AttemptSearchState search)
        {
            int candidateBudget = Math.Max(1, search.MaximumBacktracks + 1);
            for (int candidateIndex = 0; candidateIndex < candidateBudget; candidateIndex += 1)
            {
                DungeonPlanV2 candidate = null;
                IndustrialFactoryV2ValidationResult validation;
                try
                {
                    candidate = BuildCandidate(
                        search.Context,
                        search.Context.AttemptSeed + ":candidate:" + candidateIndex,
                        search.HazardKind,
                        search.MaximumBacktracks);
                    validation = validator.Validate(candidate);
                }
                catch (Exception exception)
                {
                    validation = new IndustrialFactoryV2ValidationResult(
                        new[]
                        {
                            new IndustrialFactoryV2ValidationIssue(
                                "ATTEMPT_BUILD_EXCEPTION",
                                "/generation/attempts/" + search.Context.Attempt,
                                exception.ToString())
                        });
                }

                search.CandidateCount += 1;
                search.LastValidation = validation;
                if (candidate != null && validation.Accepted)
                {
                    search.AcceptedPlan = candidate;
                    return true;
                }
                if (candidateIndex + 1 < candidateBudget)
                    search.BacktrackCount += 1;
            }
            return false;
        }

        private DungeonPlanV2 BuildCandidate(
            IndustrialFactoryV2GenerationContext context,
            string candidateSeed,
            DungeonBiomeDistrictKindV2 hazardKind,
            int maximumBacktracks)
        {
            IndustrialFactoryV2AuthoredLayout layout = new IndustrialFactoryV2AuthoredLayoutBuilder(moduleCatalog)
                .Build(candidateSeed, hazardKind, maximumBacktracks);
            List<RegionDraft> drafts = BuildRegionDrafts(layout);
            IReadOnlyList<DungeonCertifiedModulePlacementV2> placements = layout.Modules
                .Select(value => value.Placement)
                .OrderBy(value => value.ModuleInstanceId, StringComparer.Ordinal)
                .ToArray();
            IReadOnlyList<DungeonAnchorPlanV2> anchors = BuildSelectedCertifiedAnchors(
                drafts,
                placements,
                hazardKind);
            IReadOnlyList<DungeonModuleConnectorPlanV2> connectors = placements
                .SelectMany(value => value.Connectors)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            IReadOnlyList<DungeonModuleInstancePlanV2> modules = BuildModules(
                layout.Modules,
                placements,
                anchors,
                connectors);
            IReadOnlyList<DungeonRegionPlanV2> regions = BuildRegions(drafts, placements, anchors);
            IReadOnlyList<DungeonMacroRolePlanV2> macros = BuildMacros(layout.Modules);
            IReadOnlyList<DungeonEnvironmentControllerPlanV2> controllers = BuildControllers(hazardKind);
            IReadOnlyList<DungeonTraversalEdgePlanV2> edges = BuildTraversalEdges(layout);
            IReadOnlyList<DungeonSurfacePlanV2> surfaces = BuildSurfaces(
                drafts,
                placements,
                edges);
            IReadOnlyList<DungeonFluidZonePlanV2> fluidZones = BuildFluidZones(drafts, surfaces);
            IReadOnlyList<DungeonFluidNetworkPlanV2> fluidNetworks = BuildFluidNetworks(fluidZones);
            IReadOnlyList<DungeonDiscoveryPlanV2> discoveries = BuildDiscoveries(hazardKind);
            IReadOnlyList<DungeonShortcutPlanV2> shortcuts = BuildShortcuts();
            IReadOnlyList<DungeonExplorationRoutePlanV2> routes = BuildRoutes(layout, drafts, edges, discoveries);
            IReadOnlyList<DungeonFallExposurePlanV2> exposures = BuildFallExposures(drafts, surfaces);
            IReadOnlyList<DungeonFallCatchmentPlanV2> catchments = BuildFallCatchments(drafts, surfaces);
            IReadOnlyList<DungeonBiomeDistrictPlanV2> districts = BuildDistricts(
                drafts,
                hazardKind,
                controllers,
                edges);

            var plan = new DungeonPlanV2(
                DungeonPlanV2.CurrentSchemaVersion,
                IndustrialFactoryV2Ruleset.ContractVersion,
                IndustrialFactoryV2Ruleset.RulesetVersion,
                IndustrialFactoryV2Ruleset.ProfileId,
                IndustrialFactoryV2Ruleset.ContentPackVersion,
                context.Seed,
                context.AttemptSeed,
                context.Attempt - 1,
                context.Difficulty,
                FactoryRegionIds[0],
                FactoryRegionIds[6],
                PlanBounds(placements),
                DungeonVoidPolicyV2.Prohibited,
                macros,
                modules,
                connectors,
                anchors,
                regions,
                districts,
                edges,
                routes,
                discoveries,
                shortcuts,
                surfaces,
                fluidZones,
                fluidNetworks,
                controllers,
                catchments,
                exposures,
                layout.GameplayBeats,
                layout.AbstractRouteGraph,
                layout.BeatAssignments,
                layout.MiniDungeonCompositions);

            return plan;
        }

        private static List<RegionDraft> BuildRegionDrafts(
            IndustrialFactoryV2AuthoredLayout layout)
        {
            var drafts = new List<RegionDraft>();
            foreach (IndustrialFactoryV2AuthoredModuleDraft module in layout.Modules)
            {
                foreach (CertifiedDungeonRegionGeometryV2 region in module.Placement.Regions)
                {
                    drafts.Add(new RegionDraft(
                        region.Id,
                        module.MacroRoleId,
                        DistrictId(region.DistrictKind),
                        region.ElevationStratum,
                        region.Bounds,
                        module.Definition.TemplateId,
                        module.Id));
                }
            }
            return drafts.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
        }

        private static IReadOnlyList<DungeonAnchorPlanV2> BuildSelectedCertifiedAnchors(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonCertifiedModulePlacementV2> placements,
            DungeonBiomeDistrictKindV2 hazardKind)
        {
            if (drafts == null) throw new ArgumentNullException(nameof(drafts));
            if (placements == null) throw new ArgumentNullException(nameof(placements));

            RegionDraft[] draftArray = drafts.ToArray();
            var selectedIds = new HashSet<string>(StringComparer.Ordinal)
            {
                AnchorId(FactoryRegionIds[0], "spawn"),
                AnchorId(FactoryRegionIds[6], "large-refractor"),
                AnchorId(FactoryRegionIds[6], "extraction"),
                AnchorId(FactoryRegionIds[3], "valve-console"),
                AnchorId(FactoryRegionIds[3], "routing-console"),
                AnchorId(FactoryRegionIds[4], "reward"),
                AnchorId("water-freight-sump", "reward"),
                AnchorId("water-freight-sump", "drained-reward"),
                AnchorId("water-freight-sump", "flooded-reward"),
                AnchorId("water-reservoir-service", "reward"),
                AnchorId("water-gantry-sump", "reward"),
                AnchorId("water-gantry-sump", "shortcut"),
                AnchorId("hazard-undercroft-landing", "reward"),
                AnchorId("hazard-undercroft-basin", "reward"),
                AnchorId("hazard-undercroft-basin", "grounding-console")
            };
            DungeonAnchorPlanV2[] anchors = placements
                .SelectMany(value => value.Anchors)
                .Where(value => value.Kind == DungeonAnchorKindV2.Entry
                    || value.Kind == DungeonAnchorKindV2.Exit
                    || value.Kind == DungeonAnchorKindV2.Safe
                    || value.Kind == DungeonAnchorKindV2.Landmark
                    || value.Kind == DungeonAnchorKindV2.Encounter
                    || value.Id.EndsWith("-mechanism", StringComparison.Ordinal)
                    || value.Id.EndsWith("-lower-return", StringComparison.Ordinal)
                    || value.Id.EndsWith("-lower-mechanism", StringComparison.Ordinal)
                    || selectedIds.Contains(value.Id))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();

            // An authored bake is the sole source for plan anchors. These
            // checks deliberately fail generation instead of manufacturing a
            // convenient runtime anchor when the prefab bake is incomplete.
            foreach (RegionDraft draft in draftArray)
            {
                RequireCertifiedAnchor(anchors, draft.Id, "entry", DungeonAnchorKindV2.Entry);
                RequireCertifiedAnchor(anchors, draft.Id, "exit", DungeonAnchorKindV2.Exit);
                RequireCertifiedAnchor(anchors, draft.Id, "safe", DungeonAnchorKindV2.Safe);
            }

            RequireCertifiedAnchor(anchors, FactoryRegionIds[0], "spawn", DungeonAnchorKindV2.Spawn);
            RequireCertifiedAnchor(anchors, FactoryRegionIds[6], "extraction", DungeonAnchorKindV2.Extraction);
            RequireCertifiedAnchor(anchors, FactoryRegionIds[6], "large-refractor", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, FactoryRegionIds[3], "valve-console", DungeonAnchorKindV2.Console);
            RequireCertifiedAnchor(anchors, FactoryRegionIds[3], "routing-console", DungeonAnchorKindV2.Console);
            RequireCertifiedAnchor(anchors, FactoryRegionIds[4], "reward", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, "water-gantry-sump", "shortcut", DungeonAnchorKindV2.ShortcutActivation);
            RequireCertifiedAnchor(anchors, "water-gantry-sump", "reward", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, "water-freight-sump", "drained-reward", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, "water-freight-sump", "flooded-reward", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, "hazard-undercroft-landing", "reward", DungeonAnchorKindV2.Reward);
            RequireCertifiedAnchor(anchors, "hazard-undercroft-basin", "reward", DungeonAnchorKindV2.Reward);
            if (hazardKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
            {
                RequireCertifiedAnchor(
                    anchors,
                    "hazard-undercroft-basin",
                    "grounding-console",
                    DungeonAnchorKindV2.Console);
            }

            if (anchors.Select(value => value.Id).Distinct(StringComparer.Ordinal).Count() != anchors.Length)
                throw new InvalidOperationException("Certified module anchors contain duplicate stable IDs.");
            return Array.AsReadOnly(anchors);
        }

        private static void RequireCertifiedAnchor(
            IEnumerable<DungeonAnchorPlanV2> anchors,
            string regionId,
            string localId,
            DungeonAnchorKindV2 expectedKind)
        {
            string id = DungeonCertifiedModulePlacementV2.PlacedAnchorId(regionId, localId);
            DungeonAnchorPlanV2 anchor = anchors.SingleOrDefault(value =>
                string.Equals(value.Id, id, StringComparison.Ordinal));
            if (anchor == null
                || anchor.Source != DungeonSpatialRecordSourceV2.CertifiedModule
                || anchor.Kind != expectedKind)
            {
                throw new InvalidOperationException(
                    "Authored module bake is missing required " + expectedKind
                    + " anchor '" + id + "'.");
            }
        }

        private static IReadOnlyList<DungeonModuleInstancePlanV2> BuildModules(
            IEnumerable<IndustrialFactoryV2AuthoredModuleDraft> moduleDrafts,
            IEnumerable<DungeonCertifiedModulePlacementV2> placements,
            IEnumerable<DungeonAnchorPlanV2> anchors,
            IEnumerable<DungeonModuleConnectorPlanV2> connectors)
        {
            var result = new List<DungeonModuleInstancePlanV2>();
            foreach (IndustrialFactoryV2AuthoredModuleDraft draft in moduleDrafts)
            {
                string moduleId = draft.Id;
                DungeonCertifiedModulePlacementV2 placement = placements.Single(value =>
                    value.ModuleInstanceId == moduleId);
                result.Add(new DungeonModuleInstancePlanV2(
                    moduleId,
                    draft.Definition.TemplateId,
                    draft.Definition.CombinedRevisionHash,
                    draft.MacroRoleId,
                    placement.Bounds,
                    placement.Regions.Select(value => value.Id),
                    connectors.Where(connector => connector.ModuleInstanceId == moduleId).Select(connector => connector.Id),
                    anchors.Where(anchor => placement.Regions.Any(region => region.Id == anchor.RegionId)).Select(anchor => anchor.Id),
                    placement.Transform,
                    placement.RegionBindings,
                    draft.Definition.VerticalCompositionId,
                    connectors.Where(connector => connector.ModuleInstanceId == moduleId
                            && connector.Aperture?.VerticalCompositionPortalId != null)
                        .Select(connector => connector.Id)));
            }

            return result;
        }

        private static IReadOnlyList<DungeonRegionPlanV2> BuildRegions(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonCertifiedModulePlacementV2> placements,
            IEnumerable<DungeonAnchorPlanV2> anchors)
        {
            var result = new List<DungeonRegionPlanV2>();
            foreach (RegionDraft draft in drafts)
            {
                DungeonAnchorPlanV2[] regionAnchors = anchors.Where(anchor => anchor.RegionId == draft.Id).ToArray();
                DungeonCertifiedModulePlacementV2 placement = placements.Single(value =>
                    value.ModuleInstanceId == draft.ModuleId);
                CertifiedDungeonRegionGeometryV2 certifiedRegion = placement.Regions.Single(value =>
                    string.Equals(value.Id, draft.Id, StringComparison.Ordinal));
                result.Add(new DungeonRegionPlanV2(
                    draft.Id,
                    draft.MacroId,
                    new[] { draft.ModuleId },
                    certifiedRegion.Bounds,
                    certifiedRegion.ElevationStratum,
                    draft.DistrictId,
                    regionAnchors.Where(anchor => anchor.Kind == DungeonAnchorKindV2.Entry || anchor.Kind == DungeonAnchorKindV2.Exit)
                        .Select(anchor => anchor.Id),
                    regionAnchors.Where(anchor => anchor.Kind == DungeonAnchorKindV2.Encounter).Select(anchor => anchor.Id),
                    regionAnchors.Where(anchor => anchor.Kind == DungeonAnchorKindV2.Reward).Select(anchor => anchor.Id),
                    regionAnchors.Where(anchor => anchor.Kind == DungeonAnchorKindV2.Console).Select(anchor => anchor.Id),
                    regionAnchors.Where(anchor => anchor.Kind == DungeonAnchorKindV2.Landmark).Select(anchor => anchor.Id),
                    new[]
                    {
                        new DungeonEnvironmentSupportPlanV2("environment-support-" + draft.Id, DungeonAccessPredicateV2.Always)
                    },
                    certifiedRegion.LocalNavigationRegionId,
                    DungeonSpatialRecordSourceV2.CertifiedModule));
            }

            return result;
        }

        private static IReadOnlyList<DungeonMacroRolePlanV2> BuildMacros(
            IEnumerable<IndustrialFactoryV2AuthoredModuleDraft> modules)
        {
            return Array.AsReadOnly(modules
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .Select(value => new DungeonMacroRolePlanV2(
                    value.MacroRoleId,
                    value.MacroRole,
                    new[] { value.Id }))
                .ToArray());
        }

        private static IReadOnlyList<DungeonEnvironmentControllerPlanV2> BuildControllers(
            DungeonBiomeDistrictKindV2 hazardKind)
        {
            var waterTransitions = new List<DungeonControllerTransitionPlanV2>();
            string[] configurations =
            {
                IndustrialFactoryV2Ruleset.FreightSumpFilled,
                IndustrialFactoryV2Ruleset.StoredInReservoir,
                IndustrialFactoryV2Ruleset.GantrySumpFilled
            };
            DungeonAccessPredicateV2 valveUnlocked = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                DungeonPredicateOperatorV2.Equals,
                "Unlocked");
            for (int from = 0; from < configurations.Length; from += 1)
            {
                for (int to = 0; to < configurations.Length; to += 1)
                {
                    if (from == to)
                    {
                        continue;
                    }

                    waterTransitions.Add(new DungeonControllerTransitionPlanV2(
                        "water-transfer-" + configurations[from] + "-to-" + configurations[to],
                        configurations[from],
                        configurations[to],
                        2.5d,
                        valveUnlocked,
                        true));
                }
            }

            var result = new List<DungeonEnvironmentControllerPlanV2>
            {
                new DungeonEnvironmentControllerPlanV2(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    DungeonEnvironmentControllerKindV2.WaterRouting,
                    new[] { FactoryRegionIds[3], "water-freight-sump", "water-reservoir-service", "water-gantry-sump" },
                    configurations,
                    IndustrialFactoryV2Ruleset.FreightSumpFilled,
                    waterTransitions),
                new DungeonEnvironmentControllerPlanV2(
                    IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                    DungeonEnvironmentControllerKindV2.ValveUnlock,
                    new[] { FactoryRegionIds[3] },
                    new[] { "Locked", "Unlocked" },
                    "Locked",
                    new[]
                    {
                        new DungeonControllerTransitionPlanV2(
                            "unlock-water-routing",
                            "Locked",
                            "Unlocked",
                            0d,
                            DungeonAccessPredicateV2.Always,
                            true)
                    }),
                new DungeonEnvironmentControllerPlanV2(
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    DungeonEnvironmentControllerKindV2.Crumble,
                    new[] { FactoryRegionIds[5], "region-credential-upper" },
                    new[] { "Intact", "Collapsed" },
                    "Intact",
                    new[]
                    {
                        new DungeonControllerTransitionPlanV2(
                            "collapse-credential-tower-platform",
                            "Intact",
                            "Collapsed",
                            0.65d,
                            DungeonAccessPredicateV2.Always,
                            true)
                    })
            };

            if (hazardKind == DungeonBiomeDistrictKindV2.MagmaUndercroft)
            {
                result.Add(new DungeonEnvironmentControllerPlanV2(
                    IndustrialFactoryV2Ruleset.HazardControllerId,
                    DungeonEnvironmentControllerKindV2.Magma,
                    new[] { "hazard-undercroft-landing", "hazard-undercroft-basin" },
                    new[] { "Active" },
                    "Active",
                    Array.Empty<DungeonControllerTransitionPlanV2>()));
            }
            else
            {
                result.Add(new DungeonEnvironmentControllerPlanV2(
                    IndustrialFactoryV2Ruleset.HazardControllerId,
                    DungeonEnvironmentControllerKindV2.ElectricCycle,
                    new[] { "hazard-undercroft-landing", "hazard-undercroft-basin" },
                    new[] { "Cycling", "Grounded" },
                    "Cycling",
                    new[]
                    {
                        new DungeonControllerTransitionPlanV2(
                            "ground-electrical-undercroft",
                            "Cycling",
                            "Grounded",
                            0d,
                            DungeonAccessPredicateV2.Always,
                            true)
                    }));
            }

            return result;
        }

        private static IReadOnlyList<DungeonSurfacePlanV2> BuildSurfaces(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonCertifiedModulePlacementV2> placements,
            IReadOnlyList<DungeonTraversalEdgePlanV2> edges)
        {
            DungeonSurfacePlanV2[] result = placements
                .SelectMany(value => value.Surfaces)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();

            if (result.Any(value => value.Source != DungeonSpatialRecordSourceV2.CertifiedModule))
                throw new InvalidOperationException("Authored V2 surfaces may only originate from certified prefab bakes.");
            return Array.AsReadOnly(result);
        }

        private static IReadOnlyList<DungeonFluidZonePlanV2> BuildFluidZones(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonSurfacePlanV2> surfaces)
        {
            string[] regionIds = { "water-freight-sump", "water-reservoir-service", "water-gantry-sump" };
            string[] configurations =
            {
                IndustrialFactoryV2Ruleset.FreightSumpFilled,
                IndustrialFactoryV2Ruleset.StoredInReservoir,
                IndustrialFactoryV2Ruleset.GantrySumpFilled
            };
            var result = new List<DungeonFluidZonePlanV2>();
            for (int index = 0; index < regionIds.Length; index += 1)
            {
                RegionDraft draft = drafts.Single(value => value.Id == regionIds[index]);
                DungeonSurfacePlanV2 floor = surfaces.Single(value =>
                    value.RegionId == draft.Id
                    && value.Kind == DungeonSurfaceKindV2.WaterBed
                    && value.IsWalkable);
                result.Add(new DungeonFluidZonePlanV2(
                    "fluid-zone-" + draft.Id,
                    DungeonFluidKindV2.Water,
                    IndustrialFactoryV2Ruleset.WaterNetworkId,
                    draft.Id,
                    VolumePrism(draft.Bounds, draft.Bounds.Minimum.Y + 0.25d, draft.Bounds.Maximum.Y - 0.25d),
                    floor.Id,
                    new[] { configurations[index] },
                    3.15d));
            }

            return result;
        }

        private static IReadOnlyList<DungeonFluidNetworkPlanV2> BuildFluidNetworks(
            IEnumerable<DungeonFluidZonePlanV2> zones)
        {
            DungeonFluidZonePlanV2[] copy = zones.ToArray();
            return new[]
            {
                new DungeonFluidNetworkPlanV2(
                    IndustrialFactoryV2Ruleset.WaterNetworkId,
                    copy.Select(zone => zone.RegionId),
                    copy.Select(zone => zone.Id),
                    new[]
                    {
                        Configuration(IndustrialFactoryV2Ruleset.FreightSumpFilled, copy[0].Id),
                        Configuration(IndustrialFactoryV2Ruleset.StoredInReservoir, copy[1].Id),
                        Configuration(IndustrialFactoryV2Ruleset.GantrySumpFilled, copy[2].Id)
                    },
                    IndustrialFactoryV2Ruleset.FreightSumpFilled,
                    new[] { IndustrialFactoryV2Ruleset.WaterRoutingControllerId })
            };
        }

        private static IReadOnlyList<DungeonDiscoveryPlanV2> BuildDiscoveries(
            DungeonBiomeDistrictKindV2 hazardKind)
        {
            string hazardReward = hazardKind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                ? IndustrialFactoryV2Ruleset.HeatResistChipRewardId
                : IndustrialFactoryV2Ruleset.AncientBatteryPackRewardId;
            DungeonDiscoveryKindV2 hazardRewardKind = hazardKind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                ? DungeonDiscoveryKindV2.FixedChipBlueprint
                : DungeonDiscoveryKindV2.Salvage;
            DungeonAccessPredicateV2 gantryFilled = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                DungeonPredicateOperatorV2.Equals,
                IndustrialFactoryV2Ruleset.GantrySumpFilled);
            DungeonAccessPredicateV2 freightFilled = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                DungeonPredicateOperatorV2.Equals,
                IndustrialFactoryV2Ruleset.FreightSumpFilled);
            DungeonAccessPredicateV2 freightDrained = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                DungeonPredicateOperatorV2.Equals,
                IndustrialFactoryV2Ruleset.StoredInReservoir);

            return new[]
            {
                Discovery(IndustrialFactoryV2Ruleset.CredentialKeyDiscoveryId, DungeonDiscoveryKindV2.MechanismKnowledge, FactoryRegionIds[4],
                    IndustrialFactoryV2Ruleset.FactoryDistrictId, IndustrialFactoryV2Ruleset.CredentialKeyRewardId, 3),
                Discovery("discovery-factory-landmark", DungeonDiscoveryKindV2.Landmark, FactoryRegionIds[0],
                    IndustrialFactoryV2Ruleset.FactoryDistrictId, null, 1, "landmark"),
                new DungeonDiscoveryPlanV2(
                    "discovery-waterworks-major",
                    DungeonDiscoveryKindV2.Salvage,
                    AnchorId("water-freight-sump", "drained-reward"),
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                    freightDrained,
                    DungeonAccessPredicateV2.Always,
                    IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId,
                    3,
                    DungeonDiscoveryDuplicatePolicyV2.OncePerRuin),
                new DungeonDiscoveryPlanV2(
                    "discovery-waterworks-lore",
                    DungeonDiscoveryKindV2.Lore,
                    AnchorId("water-freight-sump", "flooded-reward"),
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                    freightFilled,
                    DungeonAccessPredicateV2.Always,
                    "waterworks-maintenance-record",
                    1,
                    DungeonDiscoveryDuplicatePolicyV2.OncePerRuin),
                Discovery("discovery-waterworks-landmark", DungeonDiscoveryKindV2.Landmark, "water-freight-sump",
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId, null, 1, "landmark"),
                Discovery("discovery-waterworks-shortcut", DungeonDiscoveryKindV2.Shortcut, "water-gantry-sump",
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId, IndustrialFactoryV2Ruleset.WaterworksShortcutId, 2, "shortcut"),
                new DungeonDiscoveryPlanV2(
                    "discovery-waterworks-tease",
                    DungeonDiscoveryKindV2.Salvage,
                    AnchorId("water-gantry-sump", "reward"),
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                    gantryFilled,
                    DungeonAccessPredicateV2.Always,
                    "gantry-sump-curated-cache",
                    2,
                    DungeonDiscoveryDuplicatePolicyV2.OncePerRuin),
                Discovery("discovery-hazard-major", hazardRewardKind, "hazard-undercroft-basin",
                    IndustrialFactoryV2Ruleset.HazardDistrictId, hazardReward, 3),
                Discovery("discovery-hazard-salvage", DungeonDiscoveryKindV2.Salvage, "hazard-undercroft-landing",
                    IndustrialFactoryV2Ruleset.HazardDistrictId, "undercroft-curated-salvage", 1),
                Discovery("discovery-hazard-landmark", DungeonDiscoveryKindV2.Landmark, "hazard-undercroft-landing",
                    IndustrialFactoryV2Ruleset.HazardDistrictId, null, 1, "landmark")
            };
        }

        private static IReadOnlyList<DungeonTraversalEdgePlanV2> BuildTraversalEdges(
            IndustrialFactoryV2AuthoredLayout layout)
        {
            var edges = new List<DungeonTraversalEdgePlanV2>();
            DungeonAccessPredicateV2 storedInReservoir = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                DungeonPredicateOperatorV2.Equals,
                IndustrialFactoryV2Ruleset.StoredInReservoir);
            DungeonAccessPredicateV2 credentialKey = FactPredicate(
                DungeonPredicateConditionKindV2.RequiredItem,
                IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                DungeonPredicateOperatorV2.IsPresent);
            DungeonAccessPredicateV2 gantrySumpFilled = FactPredicate(
                DungeonPredicateConditionKindV2.ControllerState,
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                DungeonPredicateOperatorV2.Equals,
                IndustrialFactoryV2Ruleset.GantrySumpFilled);
            Dictionary<string, DungeonModuleConnectorPlanV2> connectorById = layout.Modules
                .SelectMany(value => value.Placement.Connectors)
                .ToDictionary(value => value.Id, StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 abstractEdge in layout.AbstractRouteGraph.Edges)
            {
                DungeonModuleConnectorPlanV2 fromConnector = connectorById[abstractEdge.FromConnectorId];
                DungeonModuleConnectorPlanV2 toConnector = connectorById[abstractEdge.ToConnectorId];
                bool waterOperation = string.Equals(fromConnector.RegionId, FactoryRegionIds[2], StringComparison.Ordinal)
                    && string.Equals(toConnector.RegionId, FactoryRegionIds[3], StringComparison.Ordinal);
                bool credentialBoundary = string.Equals(fromConnector.RegionId, FactoryRegionIds[5], StringComparison.Ordinal)
                    && string.Equals(toConnector.RegionId, FactoryRegionIds[6], StringComparison.Ordinal);
                DungeonAccessPredicateV2 predicate = waterOperation
                    ? storedInReservoir
                    : credentialBoundary
                        ? credentialKey
                        : DungeonAccessPredicateV2.Always;
                string edgeId = "edge-abstract-" + abstractEdge.Id;
                edges.Add(Edge(
                    credentialBoundary ? IndustrialFactoryV2Ruleset.CredentialGateEdgeId : edgeId,
                    fromConnector.RegionId,
                    toConnector.RegionId,
                    fromConnector.Kind,
                    predicate,
                    credentialBoundary));
                if (abstractEdge.Bidirectional)
                {
                    edges.Add(Edge(
                        edgeId + "-reverse",
                        toConnector.RegionId,
                        fromConnector.RegionId,
                        toConnector.Kind,
                        predicate,
                        credentialBoundary));
                }
            }

            foreach (IndustrialFactoryV2AuthoredModuleDraft module in layout.Modules)
            foreach (DungeonAuthoredModuleTopologyEdgeV2 topology in module.Definition.TopologyEdges)
            {
                string fromRegionId = module.RegionIds[topology.FromLocalRegionId];
                string toRegionId = module.RegionIds[topology.ToLocalRegionId];
                DungeonAccessPredicateV2 predicate = string.Equals(toRegionId, "water-gantry-sump", StringComparison.Ordinal)
                    ? gantrySumpFilled
                    : DungeonAccessPredicateV2.Always;
                string id = "edge-internal-" + module.SlotId + "-" + topology.Id;
                edges.Add(Edge(id, fromRegionId, toRegionId, topology.Kind, predicate));
                if (topology.Bidirectional)
                    edges.Add(Edge(id + "-reverse", toRegionId, fromRegionId, topology.Kind, predicate));
            }

            edges.Add(Edge("edge-shortcut-locked", "water-gantry-sump", FactoryRegionIds[4],
                DungeonConnectorKindV2.Lift, DungeonAccessPredicateV2.Never));
            edges.Add(Edge("edge-shortcut-open", "water-gantry-sump", FactoryRegionIds[4],
                DungeonConnectorKindV2.Lift,
                FactPredicate(
                    DungeonPredicateConditionKindV2.ShortcutState,
                    IndustrialFactoryV2Ruleset.WaterworksShortcutId,
                    DungeonPredicateOperatorV2.IsPresent)));

            return Array.AsReadOnly(edges.OrderBy(value => value.Id, StringComparer.Ordinal).ToArray());
        }

        private static IReadOnlyList<DungeonShortcutPlanV2> BuildShortcuts()
        {
            return new[]
            {
                new DungeonShortcutPlanV2(
                    IndustrialFactoryV2Ruleset.WaterworksShortcutId,
                    "route-waterworks-shortcut",
                    new[] { "edge-shortcut-locked" },
                    new[] { "edge-shortcut-open" },
                    "water-gantry-sump",
                    AnchorId("water-gantry-sump", "shortcut"),
                    DungeonAccessPredicateV2.Always,
                    FactoryRegionIds[4],
                    DungeonAccessPredicateV2.Always,
                    DungeonShortcutPersistencePolicyV2.CurrentExpedition,
                    DungeonRevealPolicyV2.OnInteraction)
            };
        }

        private static IReadOnlyList<DungeonExplorationRoutePlanV2> BuildRoutes(
            IndustrialFactoryV2AuthoredLayout layout,
            IEnumerable<RegionDraft> drafts,
            IReadOnlyList<DungeonTraversalEdgePlanV2> edges,
            IReadOnlyList<DungeonDiscoveryPlanV2> discoveries)
        {
            if (layout == null) throw new ArgumentNullException(nameof(layout));
            DungeonAccessPredicateV2 credentialKey = FactPredicate(
                DungeonPredicateConditionKindV2.RequiredItem,
                IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                DungeonPredicateOperatorV2.IsPresent);
            string[] criticalEdges = layout.AbstractRouteGraph.Edges
                .Where(value => value.Role == DungeonAbstractRouteEdgeRoleV2.Critical)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .Select(value => TraversalEdgeIdForAbstractEdge(layout, value))
                .ToArray();

            DungeonAbstractRouteEdgeV2 waterFirst = layout.AbstractRouteGraph.Edges.Single(value =>
                string.Equals(value.Id, "waterworks-lower-first", StringComparison.Ordinal));
            DungeonAbstractRouteEdgeV2 waterRejoin = layout.AbstractRouteGraph.Edges.Single(value =>
                string.Equals(value.Id, "waterworks-lower-rejoin", StringComparison.Ordinal));
            IndustrialFactoryV2AuthoredModuleDraft waterEntryModule = layout.Modules.Single(value =>
                string.Equals(value.Id, waterFirst.FromNodeId, StringComparison.Ordinal));
            string waterEntryRegion = waterEntryModule.RegionIds["entry"];
            string waterLowerRegion = waterEntryModule.RegionIds["lower"];
            string waterEntryEdge = edges.Single(value =>
                string.Equals(value.FromRegionId, waterEntryRegion, StringComparison.Ordinal)
                && string.Equals(value.ToRegionId, waterLowerRegion, StringComparison.Ordinal)
                && value.Id.StartsWith("edge-internal-", StringComparison.Ordinal)
                && !value.Id.EndsWith("-reverse", StringComparison.Ordinal)).Id;
            var waterEdgeIds = new List<string>
            {
                waterEntryEdge,
                TraversalEdgeIdForAbstractEdge(layout, waterFirst)
            };
            bool rejoinContinuesBranch = string.Equals(
                waterFirst.ToNodeId,
                waterRejoin.FromNodeId,
                StringComparison.Ordinal);
            if (rejoinContinuesBranch)
                waterEdgeIds.Add(TraversalEdgeIdForAbstractEdge(layout, waterRejoin));
            string[] waterEdges = waterEdgeIds.ToArray();
            string waterReturnEdgeId = TraversalEdgeIdForAbstractEdge(layout, waterFirst) + "-reverse";
            string waterBranchExitRegion = edges.Single(value =>
                string.Equals(value.Id, waterEdges[waterEdges.Length - 1], StringComparison.Ordinal)).ToRegionId;
            string waterReturnExitRegion = edges.Single(value =>
                string.Equals(value.Id, waterReturnEdgeId, StringComparison.Ordinal)).ToRegionId;

            DungeonAbstractRouteEdgeV2 hazardEntry = layout.AbstractRouteGraph.Edges.Single(value =>
                string.Equals(value.Id, "hazard-optional-branch", StringComparison.Ordinal));
            DungeonAbstractRouteEdgeV2 hazardReturn = layout.AbstractRouteGraph.Edges.Single(value =>
                string.Equals(value.Id, "hazard-safe-return", StringComparison.Ordinal));
            IndustrialFactoryV2AuthoredModuleDraft hazardModule = layout.Modules.Single(value =>
                string.Equals(value.Id, hazardEntry.ToNodeId, StringComparison.Ordinal));
            string hazardInternalEdge = edges.Single(value =>
                string.Equals(value.FromRegionId, hazardModule.RegionIds["entry"], StringComparison.Ordinal)
                && string.Equals(value.ToRegionId, hazardModule.RegionIds["lower"], StringComparison.Ordinal)
                && value.Id.StartsWith("edge-internal-", StringComparison.Ordinal)
                && !value.Id.EndsWith("-reverse", StringComparison.Ordinal)).Id;
            string[] hazardEdges =
            {
                TraversalEdgeIdForAbstractEdge(layout, hazardEntry),
                hazardInternalEdge,
                TraversalEdgeIdForAbstractEdge(layout, hazardReturn) + "-reverse"
            };
            var result = new List<DungeonExplorationRoutePlanV2>
            {
                Route(
                    "route-critical-factory",
                    criticalEdges,
                    DungeonRouteRoleV2.Critical,
                    FactoryRegionIds[6],
                    780d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.FactoryDistrictId).Select(value => value.Id),
                    credentialKey),
                Route(
                    "route-waterworks-branch",
                    waterEdges,
                    DungeonRouteRoleV2.OptionalBranch,
                    waterBranchExitRegion,
                    210d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId).Select(value => value.Id)),
                Route(
                    "route-waterworks-return",
                    new[] { waterReturnEdgeId },
                    DungeonRouteRoleV2.Return,
                    waterReturnExitRegion,
                    25d,
                    new[] { "discovery-waterworks-landmark" }),
                Route(
                    "route-waterworks-shortcut",
                    new[] { "edge-shortcut-open" },
                    DungeonRouteRoleV2.Shortcut,
                    FactoryRegionIds[4],
                    10d,
                    new[] { "discovery-waterworks-shortcut" }),
                Route(
                    "route-waterworks-state-reveal",
                    rejoinContinuesBranch
                        ? edges.Where(value => value.Id.StartsWith("edge-internal-nest-", StringComparison.Ordinal)
                                && !value.Id.EndsWith("-reverse", StringComparison.Ordinal))
                            .Select(value => value.Id)
                        : new[] { TraversalEdgeIdForAbstractEdge(layout, waterRejoin) },
                    DungeonRouteRoleV2.StateReveal,
                    "water-gantry-sump",
                    35d,
                    new[] { "discovery-waterworks-tease", "discovery-waterworks-shortcut" }),
                Route(
                    "route-hazard-recovery",
                    hazardEdges,
                    DungeonRouteRoleV2.Recovery,
                    edges.Single(value => value.Id == "edge-abstract-hazard-optional-branch").FromRegionId,
                    180d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId).Select(value => value.Id),
                    credentialKey)
            };

            foreach (RegionDraft pocket in drafts.Where(value => value.Id.StartsWith("factory-pocket-", StringComparison.Ordinal)))
            {
                DungeonTraversalEdgePlanV2 pocketEdge = edges.FirstOrDefault(value =>
                    string.Equals(value.ToRegionId, pocket.Id, StringComparison.Ordinal)
                    && value.Id.StartsWith("edge-internal-", StringComparison.Ordinal));
                if (pocketEdge == null) continue;
                result.Add(Route(
                    "route-" + pocket.Id,
                    new[] { pocketEdge.Id },
                    DungeonRouteRoleV2.OptionalBranch,
                    pocket.Id,
                    20d,
                    Array.Empty<string>()));
            }

            return result;
        }

        private static string TraversalEdgeIdForAbstractEdge(
            IndustrialFactoryV2AuthoredLayout layout,
            DungeonAbstractRouteEdgeV2 abstractEdge)
        {
            if (layout == null) throw new ArgumentNullException(nameof(layout));
            if (abstractEdge == null) throw new ArgumentNullException(nameof(abstractEdge));
            Dictionary<string, DungeonModuleConnectorPlanV2> connectorById = layout.Modules
                .SelectMany(value => value.Placement.Connectors)
                .ToDictionary(value => value.Id, StringComparer.Ordinal);
            DungeonModuleConnectorPlanV2 from = connectorById[abstractEdge.FromConnectorId];
            DungeonModuleConnectorPlanV2 to = connectorById[abstractEdge.ToConnectorId];
            bool credentialBoundary = string.Equals(from.RegionId, FactoryRegionIds[5], StringComparison.Ordinal)
                && string.Equals(to.RegionId, FactoryRegionIds[6], StringComparison.Ordinal);
            return credentialBoundary
                ? IndustrialFactoryV2Ruleset.CredentialGateEdgeId
                : "edge-abstract-" + abstractEdge.Id;
        }

        private static IReadOnlyList<DungeonFallExposurePlanV2> BuildFallExposures(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonSurfacePlanV2> surfaces)
        {
            DungeonSurfacePlanV2[] surfaceArray = surfaces.ToArray();
            RegionDraft factoryWaterSource = drafts.Single(value => value.Id == FactoryRegionIds[2]);
            RegionDraft waterTarget = drafts.Single(value => value.Id == "water-freight-sump");
            RegionDraft sortingSource = drafts.Single(value => value.Id == FactoryRegionIds[3]);
            RegionDraft reservoirTarget = drafts.Single(value => value.Id == "water-reservoir-service");
            RegionDraft gantrySource = drafts.Single(value => value.Id == FactoryRegionIds[4]);
            RegionDraft gantryTarget = drafts.Single(value => value.Id == "water-gantry-sump");
            RegionDraft hazardSource = drafts.Single(value => value.Id == "hazard-undercroft-landing");
            RegionDraft hazardTarget = drafts.Single(value => value.Id == "hazard-undercroft-basin");
            var result = new List<DungeonFallExposurePlanV2>();
            AddShaftExposures(result, "freight-sump", factoryWaterSource, waterTarget,
                "catchment-freight-sump", surfaceArray);
            AddShaftExposures(result, "reservoir-service", sortingSource, reservoirTarget,
                "catchment-reservoir-service", surfaceArray);
            AddShaftExposures(result, "gantry-sump", gantrySource, gantryTarget,
                "catchment-gantry-sump", surfaceArray);
            AddShaftExposures(result, "hazard-undercroft", hazardSource, hazardTarget,
                "catchment-hazard-undercroft", surfaceArray);
            AddMovingPlatformExposure(
                result,
                sortingSource,
                reservoirTarget,
                "catchment-reservoir-service",
                surfaceArray);
            AddCredentialCrumbleExposure(result, surfaceArray);
            return Array.AsReadOnly(result.OrderBy(value => value.Id, StringComparer.Ordinal).ToArray());
        }

        private static void AddMovingPlatformExposure(
            ICollection<DungeonFallExposurePlanV2> result,
            RegionDraft source,
            RegionDraft target,
            string catchmentId,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            DungeonSurfacePlanV2 platform = surfaces.Single(value =>
                value.RegionId == source.Id
                && value.Kind == DungeonSurfaceKindV2.MovingPlatform);
            DungeonConvexPrismV2 catchment = BuildShaftCatchmentVolume(target, surfaces);
            const double travelDistance = 2.5d;
            double minimumX = platform.Volume.HorizontalVertices.Min(value => value.X);
            double maximumX = platform.Volume.HorizontalVertices.Max(value => value.X);
            double minimumZ = platform.Volume.HorizontalVertices.Min(value => value.Z) - travelDistance;
            double maximumZ = platform.Volume.HorizontalVertices.Max(value => value.Z) + travelDistance;
            DungeonConvexPrismV2 completeSweep = BoxPrism(
                minimumX,
                maximumX,
                platform.Volume.MinimumY,
                platform.Volume.MaximumY,
                minimumZ,
                maximumZ);
            double horizontalFailureEnvelope =
                DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed;
            DungeonConvexPrismV2 fallVolume = BoxPrism(
                minimumX - horizontalFailureEnvelope,
                maximumX + horizontalFailureEnvelope,
                catchment.MinimumY,
                platform.Volume.MaximumY,
                minimumZ - horizontalFailureEnvelope,
                maximumZ + horizontalFailureEnvelope);
            result.Add(new DungeonFallExposurePlanV2(
                "exposure-reservoir-moving-platform",
                source.Id,
                platform.Id,
                completeSweep,
                DungeonFallExposureCauseV2.MovingSurfaceFailure,
                IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed,
                fallVolume,
                Array.Empty<string>(),
                new[] { catchmentId },
                2d,
                IndustrialFactoryV2Ruleset.ReactionEnvelopeId));
        }

        private static void AddCredentialCrumbleExposure(
            ICollection<DungeonFallExposurePlanV2> result,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            DungeonSurfacePlanV2 platform = surfaces.Single(value =>
                string.Equals(
                    value.ControllerId,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    StringComparison.Ordinal)
                && value.IsWalkable);
            DungeonSurfacePlanV2 landing = surfaces.Single(value =>
                string.Equals(value.RegionId, FactoryRegionIds[5], StringComparison.Ordinal)
                && string.Equals(
                    value.Id,
                    DungeonCertifiedModulePlacementV2.PlacedSurfaceId(
                        FactoryRegionIds[5],
                        "entry-floor"),
                    StringComparison.Ordinal));
            var fallVolume = new DungeonConvexPrismV2(
                platform.Volume.HorizontalVertices,
                landing.Volume.MinimumY,
                platform.Volume.MaximumY);
            result.Add(new DungeonFallExposurePlanV2(
                "exposure-credential-crumble",
                platform.RegionId,
                platform.Id,
                platform.Volume,
                DungeonFallExposureCauseV2.Crumble,
                IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed,
                fallVolume,
                Array.Empty<string>(),
                new[] { "catchment-credential-crumble" },
                2d,
                IndustrialFactoryV2Ruleset.ReactionEnvelopeId));
        }

        private static void AddShaftExposures(
            ICollection<DungeonFallExposurePlanV2> result,
            string exposureSlug,
            RegionDraft source,
            RegionDraft target,
            string catchmentId,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            DungeonSurfacePlanV2 landing = surfaces.Single(value =>
                string.Equals(value.Id,
                    DungeonCertifiedModulePlacementV2.PlacedSurfaceId(target.Id, "return-lift-platform"),
                    StringComparison.Ordinal));
            DungeonConvexPrismV2 catchmentVolume = BuildShaftCatchmentVolume(target, surfaces);
            string[] shaftConstraintIds =
            {
                "shaft-wall-west",
                "shaft-wall-east",
                "shaft-wall-north",
                "shaft-wall-south-left",
                "shaft-wall-south-right",
                "shaft-wall-south-upper"
            };
            string[] placedConstraints = shaftConstraintIds
                .Select(localId => DungeonCertifiedModulePlacementV2.PlacedSurfaceId(target.Id, localId))
                .ToArray();
            double sourceTop = new[] { "entry-floor-west", "entry-floor-east", "entry-floor-south", "entry-floor-north" }
                .Select(localId => surfaces.Single(value => string.Equals(
                    value.Id,
                    DungeonCertifiedModulePlacementV2.PlacedSurfaceId(source.Id, localId),
                    StringComparison.Ordinal)).Volume.MaximumY)
                .Max();
            var sourceVolume = new DungeonConvexPrismV2(
                landing.Volume.HorizontalVertices,
                sourceTop - 0.25d,
                sourceTop);
            var fallVolume = new DungeonConvexPrismV2(
                catchmentVolume.HorizontalVertices,
                catchmentVolume.MaximumY,
                sourceTop + Math.Max(
                    TraversalProfilesV2.Dry.JumpHeight,
                    DungeonReactionEnvelopesV2.PlayerKnockback.MaximumRiseHeight));
            foreach (string side in new[] { "west", "east", "south", "north" })
            {
                result.Add(new DungeonFallExposurePlanV2(
                    "exposure-" + exposureSlug + "-" + side,
                    source.Id,
                    DungeonCertifiedModulePlacementV2.PlacedSurfaceId(source.Id, "entry-floor-" + side),
                    sourceVolume,
                    DungeonFallExposureCauseV2.Walk
                        | DungeonFallExposureCauseV2.Jump
                        | DungeonFallExposureCauseV2.Dodge
                        | DungeonFallExposureCauseV2.Knockback,
                    IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                    DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed,
                    fallVolume,
                    placedConstraints,
                    new[] { catchmentId },
                    2d,
                    IndustrialFactoryV2Ruleset.ReactionEnvelopeId));
            }
        }

        private static IReadOnlyList<DungeonFallCatchmentPlanV2> BuildFallCatchments(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonSurfacePlanV2> surfaces)
        {
            RegionDraft water = drafts.Single(value => value.Id == "water-freight-sump");
            RegionDraft reservoir = drafts.Single(value => value.Id == "water-reservoir-service");
            RegionDraft gantryWater = drafts.Single(value => value.Id == "water-gantry-sump");
            RegionDraft hazard = drafts.Single(value => value.Id == "hazard-undercroft-basin");
            DungeonSurfacePlanV2[] surfaceArray = surfaces.ToArray();
            DungeonSurfacePlanV2 crumble = surfaceArray.Single(value =>
                string.Equals(
                    value.ControllerId,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    StringComparison.Ordinal)
                && value.IsWalkable);
            DungeonSurfacePlanV2 credentialFloor = surfaceArray.Single(value =>
                string.Equals(value.RegionId, FactoryRegionIds[5], StringComparison.Ordinal)
                && string.Equals(
                    value.Id,
                    DungeonCertifiedModulePlacementV2.PlacedSurfaceId(
                        FactoryRegionIds[5],
                        "entry-floor"),
                    StringComparison.Ordinal));
            DungeonConvexPrismV2 crumbleCatchmentVolume = new DungeonConvexPrismV2(
                crumble.Volume.HorizontalVertices,
                credentialFloor.Volume.MinimumY,
                credentialFloor.Volume.MaximumY);
            return new[]
            {
                ShaftCatchment("freight-sump", DungeonFallCatchmentKindV2.WaterBasin, water, surfaceArray),
                ShaftCatchment("reservoir-service", DungeonFallCatchmentKindV2.WaterBasin, reservoir, surfaceArray),
                ShaftCatchment("gantry-sump", DungeonFallCatchmentKindV2.WaterBasin, gantryWater, surfaceArray),
                ShaftCatchment("hazard-undercroft", DungeonFallCatchmentKindV2.SafePad, hazard, surfaceArray),
                new DungeonFallCatchmentPlanV2(
                    "catchment-credential-crumble",
                    DungeonFallCatchmentKindV2.SafePad,
                    FactoryRegionIds[5],
                    crumbleCatchmentVolume,
                    new[] { credentialFloor.Id },
                    AnchorId(FactoryRegionIds[5], "crumble-safe"),
                    new[] { "exposure-credential-crumble" },
                    credentialFloor.Volume.MinimumY - 2d)
            };
        }

        private static DungeonFallCatchmentPlanV2 ShaftCatchment(
            string slug,
            DungeonFallCatchmentKindV2 kind,
            RegionDraft region,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            string[] safeSurfaceIds = ShaftSafeSurfaceIds(region, surfaces);
            var exposureIds = new List<string>
            {
                "exposure-" + slug + "-west",
                "exposure-" + slug + "-east",
                "exposure-" + slug + "-south",
                "exposure-" + slug + "-north"
            };
            if (string.Equals(slug, "reservoir-service", StringComparison.Ordinal))
                exposureIds.Add("exposure-reservoir-moving-platform");
            return new DungeonFallCatchmentPlanV2(
                "catchment-" + slug,
                kind,
                region.Id,
                BuildShaftCatchmentVolume(region, surfaces),
                safeSurfaceIds,
                AnchorId(region.Id, "safe"),
                exposureIds,
                region.Bounds.Minimum.Y - 2d);
        }

        private static string[] ShaftSafeSurfaceIds(
            RegionDraft region,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            string[] localIds = string.Equals(
                    region.DistrictId,
                    IndustrialFactoryV2Ruleset.HazardDistrictId,
                    StringComparison.Ordinal)
                ? new[] { "return-lift-platform", "safe-egress-south" }
                : new[] { "lower-floor" };
            string[] ids = localIds
                .Select(localId => DungeonCertifiedModulePlacementV2.PlacedSurfaceId(region.Id, localId))
                .ToArray();
            foreach (string id in ids)
            {
                if (!surfaces.Any(value => string.Equals(value.Id, id, StringComparison.Ordinal)))
                    throw new InvalidOperationException("Authored shaft catchment is missing safe surface '" + id + "'.");
            }
            return ids;
        }

        private static DungeonConvexPrismV2 BuildShaftCatchmentVolume(
            RegionDraft region,
            IReadOnlyList<DungeonSurfacePlanV2> surfaces)
        {
            DungeonSurfacePlanV2[] safeSurfaces = ShaftSafeSurfaceIds(region, surfaces)
                .Select(id => surfaces.Single(value => string.Equals(value.Id, id, StringComparison.Ordinal)))
                .ToArray();
            double minimumX = safeSurfaces.Min(value => value.Volume.HorizontalVertices.Min(point => point.X));
            double maximumX = safeSurfaces.Max(value => value.Volume.HorizontalVertices.Max(point => point.X));
            double minimumZ = safeSurfaces.Min(value => value.Volume.HorizontalVertices.Min(point => point.Z));
            double maximumZ = safeSurfaces.Max(value => value.Volume.HorizontalVertices.Max(point => point.Z));
            return BoxPrism(
                minimumX,
                maximumX,
                safeSurfaces.Min(value => value.Volume.MinimumY),
                safeSurfaces.Max(value => value.Volume.MaximumY),
                minimumZ,
                maximumZ);
        }

        private static IReadOnlyList<DungeonBiomeDistrictPlanV2> BuildDistricts(
            IEnumerable<RegionDraft> drafts,
            DungeonBiomeDistrictKindV2 hazardKind,
            IEnumerable<DungeonEnvironmentControllerPlanV2> controllers,
            IReadOnlyList<DungeonTraversalEdgePlanV2> edges)
        {
            RegionDraft[] copy = drafts.ToArray();
            string[] waterEntranceEdges = edges
                .Where(value => value.Id.StartsWith("edge-internal-", StringComparison.Ordinal)
                    && copy.Single(region => region.Id == value.FromRegionId).DistrictId == IndustrialFactoryV2Ruleset.FactoryDistrictId
                    && copy.Single(region => region.Id == value.ToRegionId).DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId)
                .Select(value => value.Id)
                .Take(2)
                .ToArray();
            return new[]
            {
                District(
                    IndustrialFactoryV2Ruleset.FactoryDistrictId,
                    DungeonBiomeDistrictKindV2.Factory,
                    copy.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.FactoryDistrictId).Select(value => value.Id),
                    Array.Empty<string>(),
                    new[] { AnchorId(FactoryRegionIds[0], "landmark") },
                    new[] { IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId },
                    2,
                    1,
                    1),
                District(
                    IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                    DungeonBiomeDistrictKindV2.Waterworks,
                    copy.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId).Select(value => value.Id),
                    waterEntranceEdges,
                    new[] { AnchorId("water-freight-sump", "landmark") },
                    new[] { IndustrialFactoryV2Ruleset.WaterRoutingControllerId, IndustrialFactoryV2Ruleset.ValveUnlockControllerId },
                    4,
                    1,
                    2),
                District(
                    IndustrialFactoryV2Ruleset.HazardDistrictId,
                    hazardKind,
                    copy.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId).Select(value => value.Id),
                    new[] { "edge-abstract-hazard-optional-branch" },
                    new[] { AnchorId("hazard-undercroft-landing", "landmark") },
                    new[] { IndustrialFactoryV2Ruleset.HazardControllerId },
                    3,
                    1,
                    2)
            };
        }

        private static DungeonAnchorPlanV2 Anchor(
            RegionDraft draft,
            string suffix,
            DungeonAnchorKindV2 kind,
            double x,
            double y,
            double z,
            string profileId = null)
        {
            return new DungeonAnchorPlanV2(
                AnchorId(draft.Id, suffix),
                draft.ModuleId,
                draft.Id,
                kind,
                new DungeonPoint3(x, y, z),
                profileId);
        }

        private static DungeonTraversalEdgePlanV2 Edge(
            string id,
            string from,
            string to,
            DungeonConnectorKindV2 kind,
            DungeonAccessPredicateV2 predicate,
            bool protectedBoundary = false)
        {
            return new DungeonTraversalEdgePlanV2(
                id,
                from,
                to,
                AnchorId(from, "exit"),
                AnchorId(to, "entry"),
                kind,
                predicate,
                protectedBoundary);
        }

        private static DungeonExplorationRoutePlanV2 Route(
            string id,
            IEnumerable<string> edges,
            DungeonRouteRoleV2 role,
            string exitRegionId,
            double seconds,
            IEnumerable<string> discoveries,
            DungeonAccessPredicateV2 exitAuthorizationPredicate = null)
        {
            return new DungeonExplorationRoutePlanV2(
                id,
                edges,
                role,
                DungeonAccessPredicateV2.Always,
                new[]
                {
                    new DungeonAuthorizedExitPlanV2(
                        id + "-exit",
                        exitRegionId,
                        exitRegionId,
                        exitAuthorizationPredicate ?? DungeonAccessPredicateV2.Always)
                },
                seconds,
                role == DungeonRouteRoleV2.Critical ? 1d : 0.5d,
                discoveries,
                DungeonReverseTraversalPolicyV2.Bidirectional,
                role == DungeonRouteRoleV2.Critical ? DungeonRevealPolicyV2.KeySeeker : DungeonRevealPolicyV2.OnEntry);
        }

        private static DungeonDiscoveryPlanV2 Discovery(
            string id,
            DungeonDiscoveryKindV2 kind,
            string regionId,
            string districtId,
            string rewardId,
            int significance,
            string anchorSuffix = "reward")
        {
            return new DungeonDiscoveryPlanV2(
                id,
                kind,
                AnchorId(regionId, anchorSuffix),
                districtId,
                DungeonAccessPredicateV2.Always,
                DungeonAccessPredicateV2.Always,
                rewardId,
                significance,
                rewardId == IndustrialFactoryV2Ruleset.CredentialKeyRewardId
                    ? DungeonDiscoveryDuplicatePolicyV2.OncePerExpedition
                    : DungeonDiscoveryDuplicatePolicyV2.OncePerRuin);
        }

        private static DungeonBiomeDistrictPlanV2 District(
            string id,
            DungeonBiomeDistrictKindV2 kind,
            IEnumerable<string> regionIds,
            IEnumerable<string> entranceEdges,
            IEnumerable<string> revealAnchors,
            IEnumerable<string> controllers,
            int discoveries,
            int loops,
            int returns)
        {
            return new DungeonBiomeDistrictPlanV2(
                id,
                kind,
                regionIds,
                entranceEdges,
                revealAnchors,
                new[] { kind.ToString().ToLowerInvariant() },
                new[] { kind == DungeonBiomeDistrictKindV2.Waterworks ? "water-compatible" : "ground-compatible" },
                id + "-landmarks-v1",
                id + "-rewards-v1",
                id + "-audio-v1",
                id + "-lighting-v1",
                id + "-minimap-v1",
                discoveries,
                loops,
                returns,
                controllers);
        }

        private static DungeonAccessPredicateV2 FactPredicate(
            DungeonPredicateConditionKindV2 kind,
            string id,
            DungeonPredicateOperatorV2 @operator,
            string expectedValue = null)
        {
            return new DungeonAccessPredicateV2(new[]
            {
                new DungeonPredicateClauseV2(new[]
                {
                    new DungeonPredicateConditionV2(kind, id, @operator, expectedValue)
                })
            });
        }

        private static DungeonFluidConfigurationPlanV2 Configuration(string id, string zoneId)
        {
            return new DungeonFluidConfigurationPlanV2(id, new[] { zoneId });
        }

        private static string DistrictId(DungeonBiomeDistrictKindV2 district)
        {
            if (district == DungeonBiomeDistrictKindV2.Factory)
                return IndustrialFactoryV2Ruleset.FactoryDistrictId;
            if (district == DungeonBiomeDistrictKindV2.Waterworks)
                return IndustrialFactoryV2Ruleset.WaterworksDistrictId;
            if (district == DungeonBiomeDistrictKindV2.MagmaUndercroft
                || district == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                return IndustrialFactoryV2Ruleset.HazardDistrictId;
            throw new ArgumentOutOfRangeException(nameof(district), district, "Unknown authored district.");
        }

        private static DungeonBounds3 PlanBounds(
            IEnumerable<DungeonCertifiedModulePlacementV2> placements)
        {
            DungeonBounds3[] values = placements.Select(value => value.Bounds).ToArray();
            if (values.Length == 0) throw new ArgumentException("At least one authored placement is required.", nameof(placements));
            const double horizontalMargin = 10d;
            const double lowerMargin = 10d;
            const double upperMargin = 6d;
            return new DungeonBounds3(
                new DungeonPoint3(
                    values.Min(value => value.Minimum.X) - horizontalMargin,
                    values.Min(value => value.Minimum.Y) - lowerMargin,
                    values.Min(value => value.Minimum.Z) - horizontalMargin),
                new DungeonPoint3(
                    values.Max(value => value.Maximum.X) + horizontalMargin,
                    values.Max(value => value.Maximum.Y) + upperMargin,
                    values.Max(value => value.Maximum.Z) + horizontalMargin));
        }

        private static DungeonConvexPrismV2 BoxPrism(
            double minimumX,
            double maximumX,
            double minimumY,
            double maximumY,
            double minimumZ,
            double maximumZ)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                minimumY,
                maximumY);
        }

        private static DungeonConvexPrismV2 VolumePrism(DungeonBounds3 bounds, double minimumY, double maximumY)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(bounds.Minimum.X, bounds.Minimum.Z),
                    new DungeonPoint2V2(bounds.Maximum.X, bounds.Minimum.Z),
                    new DungeonPoint2V2(bounds.Maximum.X, bounds.Maximum.Z),
                    new DungeonPoint2V2(bounds.Minimum.X, bounds.Maximum.Z)
                },
                minimumY,
                maximumY);
        }

        private static string SurfaceId(string regionId) => "surface-" + regionId;
        private static string AnchorId(string regionId, string suffix) => "anchor-" + regionId + "-" + suffix;

        private sealed class AttemptSearchState
        {
            public AttemptSearchState(
                IndustrialFactoryV2GenerationContext context,
                DungeonBiomeDistrictKindV2 hazardKind,
                int maximumBacktracks)
            {
                Context = context;
                HazardKind = hazardKind;
                MaximumBacktracks = maximumBacktracks;
            }

            public IndustrialFactoryV2GenerationContext Context { get; }
            public DungeonBiomeDistrictKindV2 HazardKind { get; }
            public int MaximumBacktracks { get; }
            public int CandidateCount { get; set; }
            public int BacktrackCount { get; set; }
            public IndustrialFactoryV2ValidationResult LastValidation { get; set; }
            public DungeonPlanV2 AcceptedPlan { get; set; }
        }

        private sealed class RegionDraft
        {
            public RegionDraft(
                string id,
                string macroId,
                string districtId,
                DungeonElevationStratumV2 stratum,
                DungeonBounds3 bounds,
                string templateId,
                string moduleId)
            {
                Id = id;
                MacroId = macroId;
                DistrictId = districtId;
                Stratum = stratum;
                Bounds = bounds;
                TemplateId = templateId;
                ModuleId = DungeonV2Contract.RequireId(moduleId, nameof(moduleId));
            }

            public string Id { get; }
            public string MacroId { get; }
            public string DistrictId { get; }
            public DungeonElevationStratumV2 Stratum { get; }
            public DungeonBounds3 Bounds { get; }
            public string TemplateId { get; }
            public string ModuleId { get; }
        }
    }
}
