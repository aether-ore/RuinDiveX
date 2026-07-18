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
        private static readonly DungeonMacroRoleKindV2[] MacroKinds =
        {
            DungeonMacroRoleKindV2.SecurityEntrance,
            DungeonMacroRoleKindV2.AssemblyFloor,
            DungeonMacroRoleKindV2.BrokenFreightShaft,
            DungeonMacroRoleKindV2.SortingGantry,
            DungeonMacroRoleKindV2.NestWarehouse,
            DungeonMacroRoleKindV2.CredentialTower,
            DungeonMacroRoleKindV2.MachineCore
        };

        private static readonly string[] MacroIds =
        {
            "macro-security-entrance",
            "macro-assembly-floor",
            "macro-broken-freight-shaft",
            "macro-sorting-gantry",
            "macro-nest-warehouse",
            "macro-credential-tower",
            "macro-machine-core"
        };

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

        private readonly IIndustrialFactoryV2CandidateValidator validator;

        public IndustrialFactoryV2Generator(IIndustrialFactoryV2CandidateValidator validator = null)
        {
            this.validator = validator ?? new IndustrialFactoryV2Validator();
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
                bool accepted = SearchVariants(search, 0);
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

        private bool SearchVariants(AttemptSearchState search, int macroIndex)
        {
            if (macroIndex == MacroKinds.Length)
            {
                DungeonPlanV2 candidate = null;
                IndustrialFactoryV2ValidationResult validation;
                try
                {
                    string variantSignature = string.Join(",", search.MacroVariantIds);
                    var random = new DungeonDeterministicRandom(
                        search.Context.AttemptSeed + ":layout:" + variantSignature);
                    candidate = BuildCandidate(
                        search.Context,
                        random,
                        search.HazardKind,
                        search.MacroVariantIds);
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
                                exception.GetType().Name + ": " + exception.Message)
                        });
                }

                search.CandidateCount += 1;
                search.LastValidation = validation;
                if (candidate != null && validation.Accepted)
                {
                    search.AcceptedPlan = candidate;
                    return true;
                }

                return false;
            }

            foreach (string variantId in OrderedVariantCandidates(search.Context.AttemptSeed, macroIndex))
            {
                if (!IsCompatiblePartialVariant(macroIndex, variantId)) continue;
                search.MacroVariantIds[macroIndex] = variantId;
                if (SearchVariants(search, macroIndex + 1)) return true;
                search.MacroVariantIds[macroIndex] = null;
                if (search.BacktrackCount >= search.MaximumBacktracks) return false;
                search.BacktrackCount += 1;
            }

            return false;
        }

        private static IEnumerable<string> OrderedVariantCandidates(string attemptSeed, int macroIndex)
        {
            bool preferB = (DungeonDeterministicRandom.HashSeed(
                attemptSeed + ":macro:" + macroIndex) & 1u) != 0u;
            if (preferB)
            {
                yield return IndustrialFactoryV2ModuleCatalog.VariantB;
                yield return IndustrialFactoryV2ModuleCatalog.VariantA;
            }
            else
            {
                yield return IndustrialFactoryV2ModuleCatalog.VariantA;
                yield return IndustrialFactoryV2ModuleCatalog.VariantB;
            }
        }

        private static bool IsCompatiblePartialVariant(int macroIndex, string variantId)
        {
            string expectedTemplateId = "factory-"
                + MacroKinds[macroIndex].ToString().ToLowerInvariant()
                + "-" + variantId;
            return IndustrialFactoryV2ModuleCatalog.TryGet(
                    expectedTemplateId,
                    out IndustrialFactoryV2ModuleDefinition definition)
                && definition.DistrictKind == DungeonBiomeDistrictKindV2.Factory
                && definition.CompatibleMacroRoles.Contains(MacroKinds[macroIndex]);
        }

        private static DungeonPlanV2 BuildCandidate(
            IndustrialFactoryV2GenerationContext context,
            DungeonDeterministicRandom random,
            DungeonBiomeDistrictKindV2 hazardKind,
            IReadOnlyList<string> macroVariantIds)
        {
            List<RegionDraft> drafts = BuildRegionDrafts(random, hazardKind, macroVariantIds);
            IReadOnlyList<DungeonCertifiedModulePlacementV2> placements =
                BuildCertifiedPlacements(drafts);
            IReadOnlyList<DungeonAnchorPlanV2> anchors = placements
                .SelectMany(value => value.Anchors)
                .Concat(BuildAssemblyAnchors(drafts))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            IReadOnlyList<DungeonModuleConnectorPlanV2> connectors = placements
                .SelectMany(value => value.Connectors)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            IReadOnlyList<DungeonModuleInstancePlanV2> modules = BuildModules(
                drafts,
                placements,
                anchors,
                connectors);
            IReadOnlyList<DungeonRegionPlanV2> regions = BuildRegions(drafts, placements, anchors);
            IReadOnlyList<DungeonMacroRolePlanV2> macros = BuildMacros(modules);
            IReadOnlyList<DungeonEnvironmentControllerPlanV2> controllers = BuildControllers(hazardKind);
            IReadOnlyList<DungeonTraversalEdgePlanV2> edges = BuildTraversalEdges(drafts);
            IReadOnlyList<DungeonSurfacePlanV2> surfaces = BuildSurfaces(
                drafts,
                placements,
                edges);
            IReadOnlyList<DungeonFluidZonePlanV2> fluidZones = BuildFluidZones(drafts, surfaces);
            IReadOnlyList<DungeonFluidNetworkPlanV2> fluidNetworks = BuildFluidNetworks(fluidZones);
            IReadOnlyList<DungeonDiscoveryPlanV2> discoveries = BuildDiscoveries(hazardKind);
            IReadOnlyList<DungeonShortcutPlanV2> shortcuts = BuildShortcuts();
            IReadOnlyList<DungeonExplorationRoutePlanV2> routes = BuildRoutes(drafts, discoveries);
            IReadOnlyList<DungeonFallExposurePlanV2> exposures = BuildFallExposures(drafts);
            IReadOnlyList<DungeonFallCatchmentPlanV2> catchments = BuildFallCatchments(drafts, surfaces);
            IReadOnlyList<DungeonBiomeDistrictPlanV2> districts = BuildDistricts(
                drafts,
                hazardKind,
                controllers);

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
                new DungeonBounds3(
                    new DungeonPoint3(-10d, -20d, -25d),
                    new DungeonPoint3(100d, 30d, 30d)),
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
                exposures);

            return plan;
        }

        private static List<RegionDraft> BuildRegionDrafts(
            DungeonDeterministicRandom random,
            DungeonBiomeDistrictKindV2 hazardKind,
            IReadOnlyList<string> macroVariantIds)
        {
            var drafts = new List<RegionDraft>();
            for (int index = 0; index < FactoryRegionIds.Length; index += 1)
            {
                drafts.Add(new RegionDraft(
                    FactoryRegionIds[index],
                    MacroIds[index],
                    IndustrialFactoryV2Ruleset.FactoryDistrictId,
                    DungeonElevationStratumV2.Entry,
                    Bounds(index * 12d, 0d, 0d, macroVariantIds[index]),
                    "factory-" + MacroKinds[index].ToString().ToLowerInvariant() + "-" + macroVariantIds[index]));
            }

            drafts.Add(new RegionDraft(
                "water-freight-sump",
                MacroIds[2],
                IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                DungeonElevationStratumV2.Lower,
                Bounds(24d, -6d, 9d, macroVariantIds[2]),
                "water-freight-sump-" + macroVariantIds[2]));
            drafts.Add(new RegionDraft(
                "water-reservoir-service",
                MacroIds[3],
                IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                DungeonElevationStratumV2.Lower,
                Bounds(36d, -6d, 9d, macroVariantIds[3]),
                "water-reservoir-service-" + macroVariantIds[3]));
            drafts.Add(new RegionDraft(
                "water-gantry-sump",
                MacroIds[4],
                IndustrialFactoryV2Ruleset.WaterworksDistrictId,
                DungeonElevationStratumV2.Lower,
                Bounds(48d, -6d, 9d, macroVariantIds[4]),
                "water-gantry-sump-" + macroVariantIds[4]));

            string hazardPrefix = hazardKind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                ? "magma"
                : "electrical";
            drafts.Add(new RegionDraft(
                "hazard-undercroft-landing",
                MacroIds[5],
                IndustrialFactoryV2Ruleset.HazardDistrictId,
                DungeonElevationStratumV2.Lower,
                // Align the landing footprint directly beneath the Credential
                // Tower crumble opening. A zero-horizontal-velocity crumble
                // trajectory must terminate on authored geometry.
                Bounds(60d, -6d, -6.75d, macroVariantIds[5]),
                hazardPrefix + "-landing-" + macroVariantIds[5]));
            drafts.Add(new RegionDraft(
                "hazard-undercroft-basin",
                MacroIds[6],
                IndustrialFactoryV2Ruleset.HazardDistrictId,
                DungeonElevationStratumV2.Lower,
                Bounds(72d, -6d, -9d, macroVariantIds[6]),
                hazardPrefix + "-basin-" + macroVariantIds[6]));

            int extraRegions = random.RangeInclusive(0, 6);
            for (int index = 0; index < extraRegions; index += 1)
            {
                int macroIndex = index % MacroIds.Length;
                drafts.Add(new RegionDraft(
                    "factory-pocket-" + index,
                    MacroIds[macroIndex],
                    IndustrialFactoryV2Ruleset.FactoryDistrictId,
                    DungeonElevationStratumV2.Upper,
                    Bounds(macroIndex * 12d, 3d, 8d, macroVariantIds[macroIndex]),
                    "factory-pocket-" + macroVariantIds[macroIndex]));
            }

            return drafts;
        }

        private static IReadOnlyList<DungeonCertifiedModulePlacementV2> BuildCertifiedPlacements(
            IEnumerable<RegionDraft> drafts)
        {
            return drafts.Select(draft =>
            {
                IndustrialFactoryV2ModuleDefinition definition =
                    IndustrialFactoryV2ModuleCatalog.Require(draft.TemplateId);
                return DungeonCertifiedModulePlacementV2.PlaceSingleRegion(
                    definition,
                    ModuleId(draft.Id),
                    draft.Id,
                    draft.Bounds,
                    draft.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId
                        ? IndustrialFactoryV2Ruleset.HazardControllerId
                        : null);
            }).OrderBy(value => value.ModuleInstanceId, StringComparer.Ordinal).ToArray();
        }

        private static IReadOnlyList<DungeonAnchorPlanV2> BuildAssemblyAnchors(IEnumerable<RegionDraft> drafts)
        {
            var anchors = new List<DungeonAnchorPlanV2>();
            foreach (RegionDraft draft in drafts)
            {
                double y = draft.Bounds.Minimum.Y + 0.5d;
                double centerX = (draft.Bounds.Minimum.X + draft.Bounds.Maximum.X) * 0.5d;
                double centerZ = (draft.Bounds.Minimum.Z + draft.Bounds.Maximum.Z) * 0.5d;
                anchors.Add(Anchor(draft, "reward", DungeonAnchorKindV2.Reward, centerX, y, centerZ));

                if (draft.Id == FactoryRegionIds[0])
                {
                    anchors.Add(Anchor(
                        draft,
                        "spawn",
                        DungeonAnchorKindV2.Spawn,
                        draft.Bounds.Minimum.X + 2d,
                        y,
                        centerZ));
                }

                if (draft.Id == FactoryRegionIds[1]
                    || draft.Id == FactoryRegionIds[3]
                    || draft.Id == FactoryRegionIds[4]
                    || draft.Id == FactoryRegionIds[6]
                    || draft.Id == "hazard-undercroft-basin")
                {
                    anchors.Add(Anchor(
                        draft,
                        "encounter",
                        DungeonAnchorKindV2.Encounter,
                        centerX,
                        y,
                        centerZ - 1.5d,
                        "encounter-" + draft.Id));
                }

                if (draft.Id == FactoryRegionIds[3])
                {
                    anchors.Add(Anchor(
                        draft,
                        "valve-console",
                        DungeonAnchorKindV2.Console,
                        centerX - 1.5d,
                        y,
                        centerZ + 1.5d,
                        IndustrialFactoryV2Ruleset.ValveUnlockControllerId));
                    anchors.Add(Anchor(
                        draft,
                        "routing-console",
                        DungeonAnchorKindV2.Console,
                        centerX + 1.5d,
                        y,
                        centerZ + 1.5d,
                        IndustrialFactoryV2Ruleset.WaterRoutingControllerId));
                }

                if (draft.Id == "hazard-undercroft-basin"
                    && draft.TemplateId.StartsWith("electrical", StringComparison.Ordinal))
                {
                    anchors.Add(Anchor(
                        draft,
                        "grounding-console",
                        DungeonAnchorKindV2.Console,
                        draft.Bounds.Minimum.X + 1.2d,
                        y,
                        draft.Bounds.Maximum.Z - 1.2d,
                        IndustrialFactoryV2Ruleset.HazardControllerId));
                }

                if (draft.Id == FactoryRegionIds[0]
                    || draft.Id == "water-freight-sump"
                    || draft.Id == "water-reservoir-service"
                    || draft.Id == "hazard-undercroft-landing")
                {
                    anchors.Add(Anchor(draft, "landmark", DungeonAnchorKindV2.Landmark, centerX, y + 1d, centerZ));
                }

                if (draft.Id == "water-gantry-sump")
                {
                    anchors.Add(Anchor(
                        draft,
                        "shortcut",
                        DungeonAnchorKindV2.ShortcutActivation,
                        centerX,
                        y,
                        centerZ + 1d,
                        IndustrialFactoryV2Ruleset.WaterworksShortcutId));
                }

                if (draft.Id == "water-freight-sump")
                {
                    anchors.Add(Anchor(
                        draft,
                        "drained-reward",
                        DungeonAnchorKindV2.Reward,
                        centerX + 2.25d,
                        y,
                        centerZ + 1.25d,
                        "stored-in-reservoir-only"));
                    anchors.Add(Anchor(
                        draft,
                        "flooded-reward",
                        DungeonAnchorKindV2.Reward,
                        centerX - 2.25d,
                        y + 3.5d,
                        centerZ - 1.25d,
                        "freight-sump-filled-only"));
                }

                if (draft.Id == FactoryRegionIds[6])
                {
                    anchors.Add(Anchor(
                        draft,
                        "extraction",
                        DungeonAnchorKindV2.Extraction,
                        draft.Bounds.Maximum.X - 2d,
                        y,
                        centerZ,
                        "large-refractor-extraction"));
                }
            }

            return anchors;
        }

        private static IReadOnlyList<DungeonModuleInstancePlanV2> BuildModules(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonCertifiedModulePlacementV2> placements,
            IEnumerable<DungeonAnchorPlanV2> anchors,
            IEnumerable<DungeonModuleConnectorPlanV2> connectors)
        {
            var result = new List<DungeonModuleInstancePlanV2>();
            foreach (RegionDraft draft in drafts)
            {
                string moduleId = ModuleId(draft.Id);
                DungeonCertifiedModulePlacementV2 placement = placements.Single(value =>
                    value.ModuleInstanceId == moduleId);
                result.Add(new DungeonModuleInstancePlanV2(
                    moduleId,
                    draft.TemplateId,
                    IndustrialFactoryV2ModuleCatalog.Require(draft.TemplateId).ContentHash,
                    draft.MacroId,
                    placement.Bounds,
                    new[] { draft.Id },
                    connectors.Where(connector => connector.ModuleInstanceId == moduleId).Select(connector => connector.Id),
                    anchors.Where(anchor => anchor.RegionId == draft.Id).Select(anchor => anchor.Id)));
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
                    value.ModuleInstanceId == ModuleId(draft.Id));
                CertifiedDungeonRegionGeometryV2 certifiedRegion = placement.Regions.Single();
                result.Add(new DungeonRegionPlanV2(
                    draft.Id,
                    draft.MacroId,
                    new[] { ModuleId(draft.Id) },
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
            IEnumerable<DungeonModuleInstancePlanV2> modules)
        {
            var result = new List<DungeonMacroRolePlanV2>();
            for (int index = 0; index < MacroIds.Length; index += 1)
            {
                string macroId = MacroIds[index];
                result.Add(new DungeonMacroRolePlanV2(
                    macroId,
                    MacroKinds[index],
                    modules.Where(module => module.MacroRoleId == macroId).Select(module => module.Id),
                    index));
            }

            return result;
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
                    new[] { FactoryRegionIds[5] },
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
            var result = new List<DungeonSurfacePlanV2>(placements.SelectMany(value => value.Surfaces));
            foreach (RegionDraft draft in drafts)
            {
                if (draft.Id == FactoryRegionIds[5])
                {
                    AddCredentialTowerCrumbleSurface(result, draft);
                }

                if (draft.Id == "water-reservoir-service")
                {
                    double centerX = (draft.Bounds.Minimum.X + draft.Bounds.Maximum.X) * 0.5d;
                    double centerZ = (draft.Bounds.Minimum.Z + draft.Bounds.Maximum.Z) * 0.5d;
                    DungeonConvexPrismV2 movingCatchment = ReservoirMovingCatchmentPrism(
                        draft,
                        draft.Bounds.Minimum.Y,
                        draft.Bounds.Minimum.Y + 0.25d);
                    result.Add(new DungeonSurfacePlanV2(
                        IndustrialFactoryV2Ruleset.ReservoirMovingCatchmentSurfaceId,
                        ModuleId(draft.Id),
                        draft.Id,
                        DungeonSurfaceKindV2.WaterBed,
                        movingCatchment,
                        "waterworks-moving-catchment",
                        true,
                        true,
                        DungeonAccessPredicateV2.Always));
                    AddMovingCatchmentRails(result, draft, movingCatchment);
                    result.Add(new DungeonSurfacePlanV2(
                        IndustrialFactoryV2Ruleset.ReservoirMovingPlatformSurfaceId,
                        ModuleId(draft.Id),
                        draft.Id,
                        DungeonSurfaceKindV2.MovingPlatform,
                        BoxPrism(
                            centerX - 1.6d,
                            centerX + 1.6d,
                            draft.Bounds.Maximum.Y - 1.75d,
                            draft.Bounds.Maximum.Y - 1.5d,
                            centerZ - 1.1d,
                            centerZ + 1.1d),
                        "waterworks-moving-platform",
                        true,
                        true,
                        DungeonAccessPredicateV2.Always));
                }

            }

            RegionDraft[] draftArray = drafts.ToArray();
            foreach (DungeonTraversalEdgePlanV2 edge in edges
                .Where(value => (value.Kind == DungeonConnectorKindV2.Ground
                        || value.Kind == DungeonConnectorKindV2.WaterTunnel)
                    && value.AccessPredicate.Clauses.Count > 0))
            {
                RegionDraft from = draftArray.Single(value => value.Id == edge.FromRegionId);
                RegionDraft to = draftArray.Single(value => value.Id == edge.ToRegionId);
                DungeonConvexPrismV2 bridge = TryBridgeBetween(from.Bounds, to.Bounds);
                if (bridge == null) continue;
                result.Add(new DungeonSurfacePlanV2(
                    "surface-connector-" + edge.Id,
                    ModuleId(from.Id),
                    from.Id,
                    DungeonSurfaceKindV2.Walkable,
                    bridge,
                    edge.Kind == DungeonConnectorKindV2.WaterTunnel
                        ? "waterworks-service-bridge"
                        : "factory-connector",
                    true,
                    true,
                    edge.AccessPredicate));
                AddBridgeRails(result, from, edge, bridge);
            }

            AddPerimeterProtection(result, draftArray);

            RegionDraft brokenFreight = drafts.Single(value => value.Id == FactoryRegionIds[2]);
            RegionDraft sortingGantry = drafts.Single(value => value.Id == FactoryRegionIds[3]);
            result.Add(new DungeonSurfacePlanV2(
                "surface-water-operation-bulkhead",
                ModuleId(brokenFreight.Id),
                brokenFreight.Id,
                DungeonSurfaceKindV2.DoorSweep,
                GateWallBetween(brokenFreight.Bounds, sortingGantry.Bounds),
                "factory-bulkhead-locked",
                true,
                false,
                FactPredicate(
                    DungeonPredicateConditionKindV2.ControllerState,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    DungeonPredicateOperatorV2.NotEquals,
                    IndustrialFactoryV2Ruleset.StoredInReservoir),
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId));

            RegionDraft nestWarehouse = drafts.Single(value => value.Id == FactoryRegionIds[4]);
            RegionDraft waterGantry = drafts.Single(value => value.Id == "water-gantry-sump");
            result.Add(new DungeonSurfacePlanV2(
                "surface-gantry-sump-entry-bulkhead",
                ModuleId(nestWarehouse.Id),
                nestWarehouse.Id,
                DungeonSurfaceKindV2.DoorSweep,
                GateWallAcrossZ(nestWarehouse.Bounds, waterGantry.Bounds),
                "waterworks-state-bulkhead",
                true,
                false,
                FactPredicate(
                    DungeonPredicateConditionKindV2.ControllerState,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    DungeonPredicateOperatorV2.NotEquals,
                    IndustrialFactoryV2Ruleset.GantrySumpFilled),
                IndustrialFactoryV2Ruleset.WaterRoutingControllerId));

            RegionDraft credentialTower = drafts.Single(value => value.Id == FactoryRegionIds[5]);
            RegionDraft machineCore = drafts.Single(value => value.Id == FactoryRegionIds[6]);
            result.Add(new DungeonSurfacePlanV2(
                "surface-credential-bulkhead",
                ModuleId(credentialTower.Id),
                credentialTower.Id,
                DungeonSurfaceKindV2.DoorSweep,
                GateWallBetween(credentialTower.Bounds, machineCore.Bounds),
                "factory-credential-bulkhead",
                true,
                false,
                FactPredicate(
                    DungeonPredicateConditionKindV2.RequiredItem,
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                    DungeonPredicateOperatorV2.IsAbsent)));

            RegionDraft credentialUpperPocket = draftArray.FirstOrDefault(value =>
                string.Equals(value.Id, "factory-pocket-5", StringComparison.Ordinal));
            if (credentialUpperPocket != null)
            {
                // The optional Credential Tower observation pocket sits above
                // the ordinary door span. Certify the upper continuation of
                // the same bulkhead so the flooded ledge envelope cannot jump
                // around the credential gate into Machine Core.
                result.Add(new DungeonSurfacePlanV2(
                    "surface-credential-upper-bulkhead",
                    ModuleId(credentialTower.Id),
                    credentialTower.Id,
                    DungeonSurfaceKindV2.DoorSweep,
                    BoxPrism(
                        credentialTower.Bounds.Maximum.X,
                        machineCore.Bounds.Minimum.X,
                        credentialTower.Bounds.Minimum.Y,
                        Math.Max(credentialUpperPocket.Bounds.Maximum.Y, 10d),
                        credentialUpperPocket.Bounds.Minimum.Z - 0.5d,
                        credentialUpperPocket.Bounds.Maximum.Z + 0.5d),
                    "factory-credential-bulkhead",
                    true,
                    false,
                    FactPredicate(
                        DungeonPredicateConditionKindV2.RequiredItem,
                        IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                        DungeonPredicateOperatorV2.IsAbsent)));
            }

            RegionDraft undercroftBasin = drafts.Single(value => value.Id == "hazard-undercroft-basin");
            result.Add(new DungeonSurfacePlanV2(
                "surface-undercroft-credential-hatch",
                ModuleId(undercroftBasin.Id),
                undercroftBasin.Id,
                DungeonSurfaceKindV2.DoorSweep,
                GateWallAcrossZ(undercroftBasin.Bounds, machineCore.Bounds),
                "factory-credential-hatch",
                true,
                false,
                FactPredicate(
                    DungeonPredicateConditionKindV2.RequiredItem,
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                    DungeonPredicateOperatorV2.IsAbsent)));

            return result;
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
                DungeonSurfacePlanV2 floor = surfaces.Single(value => value.Id == SurfaceId(draft.Id));
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

        private static IReadOnlyList<DungeonTraversalEdgePlanV2> BuildTraversalEdges(IEnumerable<RegionDraft> drafts)
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
            for (int index = 0; index < FactoryRegionIds.Length - 1; index += 1)
            {
                DungeonAccessPredicateV2 predicate = index == 2
                    ? storedInReservoir
                    : index == 5
                        ? credentialKey
                        : DungeonAccessPredicateV2.Always;
                edges.Add(Edge(
                    index == 5
                        ? IndustrialFactoryV2Ruleset.CredentialGateEdgeId
                        : "edge-factory-" + index + "-" + (index + 1),
                    FactoryRegionIds[index],
                    FactoryRegionIds[index + 1],
                    DungeonConnectorKindV2.Ground,
                    predicate,
                    index == 5));
            }

            edges.Add(Edge("edge-factory-to-freight-sump", FactoryRegionIds[2], "water-freight-sump",
                DungeonConnectorKindV2.Drop, DungeonAccessPredicateV2.Always));
            edges.Add(Edge("edge-freight-sump-return", "water-freight-sump", FactoryRegionIds[3],
                DungeonConnectorKindV2.Jump, DungeonAccessPredicateV2.Always));
            edges.Add(Edge("edge-water-freight-reservoir", "water-freight-sump", "water-reservoir-service",
                DungeonConnectorKindV2.WaterTunnel, storedInReservoir));
            edges.Add(Edge("edge-water-reservoir-gantry", "water-reservoir-service", "water-gantry-sump",
                DungeonConnectorKindV2.WaterTunnel, DungeonAccessPredicateV2.Always));
            edges.Add(Edge("edge-nest-to-gantry-sump", FactoryRegionIds[4], "water-gantry-sump",
                DungeonConnectorKindV2.Drop, gantrySumpFilled));

            edges.Add(Edge("edge-shortcut-locked", "water-gantry-sump", FactoryRegionIds[4],
                DungeonConnectorKindV2.Lift, DungeonAccessPredicateV2.Never));
            edges.Add(Edge("edge-shortcut-open", "water-gantry-sump", FactoryRegionIds[4],
                DungeonConnectorKindV2.Lift,
                FactPredicate(
                    DungeonPredicateConditionKindV2.ShortcutState,
                    IndustrialFactoryV2Ruleset.WaterworksShortcutId,
                    DungeonPredicateOperatorV2.IsPresent)));

            edges.Add(Edge("edge-factory-to-undercroft", FactoryRegionIds[5], "hazard-undercroft-landing",
                DungeonConnectorKindV2.Drop, DungeonAccessPredicateV2.Always));
            edges.Add(Edge("edge-undercroft-landing-basin", "hazard-undercroft-landing", "hazard-undercroft-basin",
                DungeonConnectorKindV2.Ground, DungeonAccessPredicateV2.Always));
            edges.Add(Edge("edge-undercroft-rejoin", "hazard-undercroft-basin", FactoryRegionIds[6],
                DungeonConnectorKindV2.Lift, credentialKey, true));

            foreach (RegionDraft pocket in drafts.Where(value => value.Id.StartsWith("factory-pocket-", StringComparison.Ordinal)))
            {
                int macroIndex = Array.IndexOf(MacroIds, pocket.MacroId);
                edges.Add(Edge(
                    "edge-pocket-" + pocket.Id,
                    FactoryRegionIds[macroIndex],
                    pocket.Id,
                    DungeonConnectorKindV2.Jump,
                    DungeonAccessPredicateV2.Always));
            }

            return edges;
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
            IEnumerable<RegionDraft> drafts,
            IReadOnlyList<DungeonDiscoveryPlanV2> discoveries)
        {
            DungeonAccessPredicateV2 credentialKey = FactPredicate(
                DungeonPredicateConditionKindV2.RequiredItem,
                IndustrialFactoryV2Ruleset.CredentialKeyRewardId,
                DungeonPredicateOperatorV2.IsPresent);
            var result = new List<DungeonExplorationRoutePlanV2>
            {
                Route(
                    "route-critical-factory",
                    Enumerable.Range(0, 6).Select(index => "edge-factory-" + index + "-" + (index + 1)),
                    DungeonRouteRoleV2.Critical,
                    FactoryRegionIds[6],
                    780d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.FactoryDistrictId).Select(value => value.Id),
                    credentialKey),
                Route(
                    "route-waterworks-branch",
                    new[] { "edge-factory-to-freight-sump", "edge-water-freight-reservoir", "edge-water-reservoir-gantry" },
                    DungeonRouteRoleV2.OptionalBranch,
                    "water-gantry-sump",
                    210d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId).Select(value => value.Id)),
                Route(
                    "route-waterworks-return",
                    new[] { "edge-freight-sump-return" },
                    DungeonRouteRoleV2.Return,
                    FactoryRegionIds[3],
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
                    new[] { "edge-nest-to-gantry-sump" },
                    DungeonRouteRoleV2.StateReveal,
                    "water-gantry-sump",
                    35d,
                    new[] { "discovery-waterworks-tease", "discovery-waterworks-shortcut" }),
                Route(
                    "route-hazard-recovery",
                    new[] { "edge-factory-to-undercroft", "edge-undercroft-landing-basin", "edge-undercroft-rejoin" },
                    DungeonRouteRoleV2.Recovery,
                    FactoryRegionIds[6],
                    180d,
                    discoveries.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId).Select(value => value.Id),
                    credentialKey)
            };

            foreach (RegionDraft pocket in drafts.Where(value => value.Id.StartsWith("factory-pocket-", StringComparison.Ordinal)))
            {
                result.Add(Route(
                    "route-" + pocket.Id,
                    new[] { "edge-pocket-" + pocket.Id },
                    DungeonRouteRoleV2.OptionalBranch,
                    pocket.Id,
                    20d,
                    Array.Empty<string>()));
            }

            return result;
        }

        private static IReadOnlyList<DungeonFallExposurePlanV2> BuildFallExposures(IEnumerable<RegionDraft> drafts)
        {
            RegionDraft factoryWaterSource = drafts.Single(value => value.Id == FactoryRegionIds[2]);
            RegionDraft waterTarget = drafts.Single(value => value.Id == "water-freight-sump");
            RegionDraft gantrySource = drafts.Single(value => value.Id == FactoryRegionIds[4]);
            RegionDraft gantryTarget = drafts.Single(value => value.Id == "water-gantry-sump");
            RegionDraft reservoir = drafts.Single(value => value.Id == "water-reservoir-service");
            RegionDraft factoryHazardSource = drafts.Single(value => value.Id == FactoryRegionIds[5]);
            RegionDraft hazardTarget = drafts.Single(value => value.Id == "hazard-undercroft-landing");
            return new[]
            {
                Exposure("exposure-freight-sump", factoryWaterSource, waterTarget, "catchment-freight-sump"),
                Exposure("exposure-gantry-sump", gantrySource, gantryTarget, "catchment-gantry-sump"),
                MovingPlatformExposure(reservoir),
                Exposure(
                    "exposure-hazard-undercroft-main-lip",
                    factoryHazardSource,
                    hazardTarget,
                    "catchment-hazard-undercroft",
                    sourceSurfaceId: SurfaceId(factoryHazardSource.Id)),
                Exposure(
                    "exposure-hazard-undercroft-west-lip",
                    factoryHazardSource,
                    hazardTarget,
                    "catchment-hazard-undercroft",
                    sourceSurfaceId: DungeonCertifiedModulePlacementV2.PlacedSurfaceId(
                        factoryHazardSource.Id,
                        "tower-floor-south-west")),
                Exposure(
                    "exposure-hazard-undercroft-east-lip",
                    factoryHazardSource,
                    hazardTarget,
                    "catchment-hazard-undercroft",
                    sourceSurfaceId: DungeonCertifiedModulePlacementV2.PlacedSurfaceId(
                        factoryHazardSource.Id,
                        "tower-floor-south-east")),
                Exposure(
                    "exposure-hazard-undercroft",
                    factoryHazardSource,
                    hazardTarget,
                    "catchment-hazard-undercroft",
                    DungeonFallExposureCauseV2.Crumble,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleSurfaceId)
            };
        }

        private static IReadOnlyList<DungeonFallCatchmentPlanV2> BuildFallCatchments(
            IEnumerable<RegionDraft> drafts,
            IEnumerable<DungeonSurfacePlanV2> surfaces)
        {
            RegionDraft water = drafts.Single(value => value.Id == "water-freight-sump");
            RegionDraft reservoir = drafts.Single(value => value.Id == "water-reservoir-service");
            RegionDraft gantryWater = drafts.Single(value => value.Id == "water-gantry-sump");
            RegionDraft hazard = drafts.Single(value => value.Id == "hazard-undercroft-landing");
            return new[]
            {
                new DungeonFallCatchmentPlanV2(
                    "catchment-freight-sump",
                    DungeonFallCatchmentKindV2.WaterBasin,
                    water.Id,
                    VolumePrism(water.Bounds, water.Bounds.Minimum.Y, water.Bounds.Maximum.Y),
                    new[] { SurfaceId(water.Id) },
                    AnchorId(water.Id, "safe"),
                    new[] { "exposure-freight-sump" },
                    water.Bounds.Minimum.Y - 2d),
                new DungeonFallCatchmentPlanV2(
                    "catchment-reservoir-moving-platform",
                    DungeonFallCatchmentKindV2.WaterBasin,
                    reservoir.Id,
                    ReservoirMovingCatchmentPrism(
                        reservoir,
                        reservoir.Bounds.Minimum.Y,
                        reservoir.Bounds.Maximum.Y),
                    new[] { IndustrialFactoryV2Ruleset.ReservoirMovingCatchmentSurfaceId },
                    AnchorId(reservoir.Id, "safe"),
                    new[] { "exposure-reservoir-moving-platform" },
                    reservoir.Bounds.Minimum.Y - 2d),
                new DungeonFallCatchmentPlanV2(
                    "catchment-gantry-sump",
                    DungeonFallCatchmentKindV2.WaterBasin,
                    gantryWater.Id,
                    VolumePrism(gantryWater.Bounds, gantryWater.Bounds.Minimum.Y, gantryWater.Bounds.Maximum.Y),
                    new[] { SurfaceId(gantryWater.Id) },
                    AnchorId(gantryWater.Id, "safe"),
                    new[] { "exposure-gantry-sump" },
                    gantryWater.Bounds.Minimum.Y - 2d),
                new DungeonFallCatchmentPlanV2(
                    "catchment-hazard-undercroft",
                    DungeonFallCatchmentKindV2.SafePad,
                    hazard.Id,
                    VolumePrism(hazard.Bounds, hazard.Bounds.Minimum.Y, hazard.Bounds.Maximum.Y),
                    new[] { SurfaceId(hazard.Id) },
                    AnchorId(hazard.Id, "safe"),
                    new[]
                    {
                        "exposure-hazard-undercroft",
                        "exposure-hazard-undercroft-main-lip",
                        "exposure-hazard-undercroft-west-lip",
                        "exposure-hazard-undercroft-east-lip"
                    },
                    hazard.Bounds.Minimum.Y - 2d)
            };
        }

        private static IReadOnlyList<DungeonBiomeDistrictPlanV2> BuildDistricts(
            IEnumerable<RegionDraft> drafts,
            DungeonBiomeDistrictKindV2 hazardKind,
            IEnumerable<DungeonEnvironmentControllerPlanV2> controllers)
        {
            RegionDraft[] copy = drafts.ToArray();
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
                    new[] { "edge-factory-to-freight-sump", "edge-nest-to-gantry-sump" },
                    new[] { AnchorId("water-freight-sump", "landmark") },
                    new[] { IndustrialFactoryV2Ruleset.WaterRoutingControllerId, IndustrialFactoryV2Ruleset.ValveUnlockControllerId },
                    4,
                    1,
                    2),
                District(
                    IndustrialFactoryV2Ruleset.HazardDistrictId,
                    hazardKind,
                    copy.Where(value => value.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId).Select(value => value.Id),
                    new[] { "edge-factory-to-undercroft" },
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
                ModuleId(draft.Id),
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

        private static DungeonFallExposurePlanV2 Exposure(
            string id,
            RegionDraft source,
            RegionDraft target,
            string catchmentId,
            DungeonFallExposureCauseV2 additionalCauses = DungeonFallExposureCauseV2.None,
            string sourceSurfaceId = null)
        {
            DungeonBounds3 combined = new DungeonBounds3(
                new DungeonPoint3(
                    Math.Min(source.Bounds.Minimum.X, target.Bounds.Minimum.X),
                    target.Bounds.Minimum.Y,
                    Math.Min(source.Bounds.Minimum.Z, target.Bounds.Minimum.Z)),
                new DungeonPoint3(
                    Math.Max(source.Bounds.Maximum.X, target.Bounds.Maximum.X),
                    source.Bounds.Maximum.Y,
                    Math.Max(source.Bounds.Maximum.Z, target.Bounds.Maximum.Z)));
            return new DungeonFallExposurePlanV2(
                id,
                source.Id,
                string.IsNullOrWhiteSpace(sourceSurfaceId) ? SurfaceId(source.Id) : sourceSurfaceId,
                VolumePrism(source.Bounds, source.Bounds.Minimum.Y, source.Bounds.Minimum.Y + 0.5d),
                DungeonFallExposureCauseV2.Walk
                    | DungeonFallExposureCauseV2.Jump
                    | DungeonFallExposureCauseV2.Dodge
                    | DungeonFallExposureCauseV2.Knockback
                    | additionalCauses,
                IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                8.1d,
                VolumePrism(
                    combined,
                    target.Bounds.Minimum.Y,
                    source.Bounds.Minimum.Y + 0.5d + Math.Max(
                        TraversalProfilesV2.Dry.JumpHeight,
                        DungeonReactionEnvelopesV2.PlayerKnockback.MaximumRiseHeight)),
                Array.Empty<string>(),
                new[] { catchmentId },
                2d,
                IndustrialFactoryV2Ruleset.ReactionEnvelopeId);
        }

        private static DungeonFallExposurePlanV2 MovingPlatformExposure(RegionDraft reservoir)
        {
            double centerX = (reservoir.Bounds.Minimum.X + reservoir.Bounds.Maximum.X) * 0.5d;
            double centerZ = (reservoir.Bounds.Minimum.Z + reservoir.Bounds.Maximum.Z) * 0.5d;
            DungeonConvexPrismV2 platform = BoxPrism(
                centerX - 1.6d,
                centerX + 1.6d,
                reservoir.Bounds.Maximum.Y - 1.75d,
                reservoir.Bounds.Maximum.Y - 1.5d,
                centerZ - 1.1d,
                centerZ + 1.1d);
            return new DungeonFallExposurePlanV2(
                "exposure-reservoir-moving-platform",
                reservoir.Id,
                IndustrialFactoryV2Ruleset.ReservoirMovingPlatformSurfaceId,
                platform,
                DungeonFallExposureCauseV2.Walk
                    | DungeonFallExposureCauseV2.Jump
                    | DungeonFallExposureCauseV2.Dodge
                    | DungeonFallExposureCauseV2.MovingSurfaceFailure,
                IndustrialFactoryV2Ruleset.TraversalProfileVersion,
                8.1d,
                ReservoirMovingCatchmentPrism(
                    reservoir,
                    reservoir.Bounds.Minimum.Y,
                    platform.MaximumY + TraversalProfilesV2.Flooded.JumpHeight),
                Array.Empty<string>(),
                new[] { "catchment-reservoir-moving-platform" },
                2d,
                IndustrialFactoryV2Ruleset.ReactionEnvelopeId);
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

        private static DungeonBounds3 Bounds(
            double centerX,
            double minimumY,
            double centerZ,
            string spatialVariantId)
        {
            // The two authored module families have genuinely different
            // footprints. Keeping the X socket spacing fixed lets modules
            // compose constructively while the deeper B family changes
            // sightlines, landing areas, encounter clearance, and route
            // rhythm instead of being a cosmetic/template-name variation.
            double halfDepth = string.Equals(spatialVariantId, "variant-b", StringComparison.Ordinal)
                ? 4.75d
                : 4d;
            return new DungeonBounds3(
                new DungeonPoint3(centerX - 5d, minimumY, centerZ - halfDepth),
                new DungeonPoint3(centerX + 5d, minimumY + 5d, centerZ + halfDepth));
        }

        private static DungeonConvexPrismV2 FloorPrism(DungeonBounds3 bounds)
        {
            return VolumePrism(bounds, bounds.Minimum.Y, bounds.Minimum.Y + 0.25d);
        }

        private static void AddCredentialTowerCrumbleSurface(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft draft)
        {
            double centerX = (draft.Bounds.Minimum.X + draft.Bounds.Maximum.X) * 0.5d;
            double crumbleNorth = draft.Bounds.Minimum.Z + 3d;
            surfaces.Add(new DungeonSurfacePlanV2(
                IndustrialFactoryV2Ruleset.CredentialCrumbleSurfaceId,
                ModuleId(draft.Id),
                draft.Id,
                DungeonSurfaceKindV2.Walkable,
                BoxPrism(
                    centerX - 2d,
                    centerX + 2d,
                    draft.Bounds.Minimum.Y,
                    draft.Bounds.Minimum.Y + 0.25d,
                    draft.Bounds.Minimum.Z,
                    crumbleNorth),
                "factory-crumble-warning",
                true,
                true,
                FactPredicate(
                    DungeonPredicateConditionKindV2.ControllerState,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    DungeonPredicateOperatorV2.NotEquals,
                    "Collapsed"),
                IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                DungeonSpatialRecordSourceV2.AssemblyAddition));
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

        private static DungeonConvexPrismV2 InsetFloorPrism(DungeonBounds3 bounds, double inset)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(bounds.Minimum.X + inset, bounds.Minimum.Z + inset),
                    new DungeonPoint2V2(bounds.Maximum.X - inset, bounds.Minimum.Z + inset),
                    new DungeonPoint2V2(bounds.Maximum.X - inset, bounds.Maximum.Z - inset),
                    new DungeonPoint2V2(bounds.Minimum.X + inset, bounds.Maximum.Z - inset)
                },
                bounds.Minimum.Y + 0.25d,
                bounds.Minimum.Y + 0.5d);
        }

        private static DungeonConvexPrismV2 GateWallBetween(
            DungeonBounds3 from,
            DungeonBounds3 to)
        {
            double centerX = (from.Maximum.X + to.Minimum.X) * 0.5d;
            double minimumY = Math.Min(from.Minimum.Y, to.Minimum.Y);
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(centerX - 0.35d, -10d),
                    new DungeonPoint2V2(centerX + 0.35d, -10d),
                    new DungeonPoint2V2(centerX + 0.35d, 10d),
                    new DungeonPoint2V2(centerX - 0.35d, 10d)
                },
                minimumY,
                minimumY + 8d);
        }

        private static DungeonConvexPrismV2 GateWallAcrossZ(
            DungeonBounds3 from,
            DungeonBounds3 to)
        {
            double centerZ = (from.Maximum.Z + to.Minimum.Z) * 0.5d;
            double centerX = ((from.Minimum.X + from.Maximum.X) + (to.Minimum.X + to.Maximum.X)) * 0.25d;
            double minimumY = Math.Min(from.Minimum.Y, to.Minimum.Y);
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(centerX - 10d, centerZ - 0.35d),
                    new DungeonPoint2V2(centerX + 10d, centerZ - 0.35d),
                    new DungeonPoint2V2(centerX + 10d, centerZ + 0.35d),
                    new DungeonPoint2V2(centerX - 10d, centerZ + 0.35d)
                },
                minimumY,
                minimumY + 14d);
        }

        private static DungeonConvexPrismV2 TryBridgeBetween(
            DungeonBounds3 from,
            DungeonBounds3 to)
        {
            if (Math.Abs(from.Minimum.Y - to.Minimum.Y) > 1e-9d)
            {
                return null;
            }

            double minimumZ = Math.Max(from.Minimum.Z, to.Minimum.Z);
            double maximumZ = Math.Min(from.Maximum.Z, to.Maximum.Z);
            if (maximumZ - minimumZ < 1d)
            {
                return null;
            }

            double minimumX;
            double maximumX;
            if (from.Maximum.X <= to.Minimum.X)
            {
                minimumX = from.Maximum.X;
                maximumX = to.Minimum.X;
            }
            else if (to.Maximum.X <= from.Minimum.X)
            {
                minimumX = to.Maximum.X;
                maximumX = from.Minimum.X;
            }
            else
            {
                return null;
            }

            if (maximumX - minimumX <= 1e-9d)
            {
                return null;
            }

            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                from.Minimum.Y,
                from.Minimum.Y + 0.25d);
        }

        private static void AddPerimeterProtection(
            ICollection<DungeonSurfacePlanV2> surfaces,
            IEnumerable<RegionDraft> drafts)
        {
            RegionDraft[] draftArray = drafts.ToArray();
            var macrosWithPockets = new HashSet<string>(
                draftArray.Where(value => value.Id.StartsWith("factory-pocket-", StringComparison.Ordinal))
                    .Select(value => value.MacroId),
                StringComparer.Ordinal);
            foreach (RegionDraft draft in draftArray)
            {
                DungeonBounds3 bounds = draft.Bounds;
                bool factory = draft.DistrictId == IndustrialFactoryV2Ruleset.FactoryDistrictId
                    && !draft.Id.StartsWith("factory-pocket-", StringComparison.Ordinal);
                bool pocket = draft.Id.StartsWith("factory-pocket-", StringComparison.Ordinal);
                bool water = draft.DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId;
                bool hazard = draft.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId;

                if (factory)
                {
                    if (draft.Id == FactoryRegionIds[2]
                        || draft.Id == FactoryRegionIds[4]
                        || macrosWithPockets.Contains(draft.MacroId))
                    {
                        AddHorizontalRailSegments(surfaces, draft, "north", bounds.Maximum.Z, 4d);
                    }
                    else
                    {
                        AddHorizontalRail(surfaces, draft, "north", bounds.Maximum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    }

                    if (draft.Id == FactoryRegionIds[5])
                    {
                        AddHorizontalRailSegments(surfaces, draft, "south", bounds.Minimum.Z, 4d);
                    }
                    else
                    {
                        AddHorizontalRail(surfaces, draft, "south", bounds.Minimum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    }

                    if (draft.Id == FactoryRegionIds[0])
                        AddVerticalRail(surfaces, draft, "west", bounds.Minimum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                    if (draft.Id == FactoryRegionIds[6])
                        AddVerticalRail(surfaces, draft, "east", bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                }
                else if (water)
                {
                    AddHorizontalRail(surfaces, draft, "north", bounds.Maximum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    if (draft.Id == "water-freight-sump")
                    {
                        AddHorizontalRail(surfaces, draft, "south-a", bounds.Minimum.Z, bounds.Minimum.X, bounds.Maximum.X - 3d);
                        AddVerticalRail(surfaces, draft, "west", bounds.Minimum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                    }
                    else if (draft.Id == "water-gantry-sump")
                    {
                        AddHorizontalRailSegments(surfaces, draft, "south", bounds.Minimum.Z, 4d);
                    }
                    else
                    {
                        AddHorizontalRail(surfaces, draft, "south", bounds.Minimum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    }

                    if (draft.Id == "water-gantry-sump")
                        AddVerticalRail(surfaces, draft, "east", bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                }
                else if (hazard)
                {
                    AddHorizontalRail(surfaces, draft, "south", bounds.Minimum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    if (draft.Id == "hazard-undercroft-landing")
                    {
                        AddHorizontalRailSegments(surfaces, draft, "north", bounds.Maximum.Z, 4d);
                        AddVerticalRail(surfaces, draft, "west", bounds.Minimum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                    }
                    else
                    {
                        AddHorizontalRail(surfaces, draft, "north", bounds.Maximum.Z, bounds.Minimum.X, bounds.Maximum.X);
                        AddVerticalRail(surfaces, draft, "east", bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                    }
                }
                else if (pocket)
                {
                    AddHorizontalRail(surfaces, draft, "north", bounds.Maximum.Z, bounds.Minimum.X, bounds.Maximum.X);
                    AddHorizontalRailSegments(surfaces, draft, "south", bounds.Minimum.Z, 4d);
                    AddVerticalRail(surfaces, draft, "west", bounds.Minimum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                    AddVerticalRail(surfaces, draft, "east", bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z);
                }
            }
        }

        private static void AddBridgeRails(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft owner,
            DungeonTraversalEdgePlanV2 edge,
            DungeonConvexPrismV2 bridge)
        {
            double minimumX = bridge.HorizontalVertices.Min(value => value.X);
            double maximumX = bridge.HorizontalVertices.Max(value => value.X);
            double minimumZ = bridge.HorizontalVertices.Min(value => value.Z);
            double maximumZ = bridge.HorizontalVertices.Max(value => value.Z);
            AddBridgeRail(
                surfaces,
                owner,
                edge,
                "north",
                minimumX,
                maximumX,
                maximumZ - 0.12d,
                maximumZ + 0.12d,
                bridge.MaximumY);
            AddBridgeRail(
                surfaces,
                owner,
                edge,
                "south",
                minimumX,
                maximumX,
                minimumZ - 0.12d,
                minimumZ + 0.12d,
                bridge.MaximumY);
        }

        private static void AddBridgeRail(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft owner,
            DungeonTraversalEdgePlanV2 edge,
            string suffix,
            double minimumX,
            double maximumX,
            double minimumZ,
            double maximumZ,
            double minimumY)
        {
            surfaces.Add(new DungeonSurfacePlanV2(
                "surface-connector-rail-" + edge.Id + "-" + suffix,
                ModuleId(owner.Id),
                owner.Id,
                DungeonSurfaceKindV2.Rail,
                BoxPrism(
                    minimumX,
                    maximumX,
                    minimumY,
                    minimumY + 2.4d,
                    minimumZ,
                    maximumZ),
                edge.Kind == DungeonConnectorKindV2.WaterTunnel
                    ? "waterworks-safety-rail"
                    : "factory-safety-rail",
                true,
                false,
                edge.AccessPredicate));
        }

        private static void AddMovingCatchmentRails(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft owner,
            DungeonConvexPrismV2 catchment)
        {
            double minimumX = catchment.HorizontalVertices.Min(value => value.X);
            double maximumX = catchment.HorizontalVertices.Max(value => value.X);
            double minimumZ = catchment.HorizontalVertices.Min(value => value.Z);
            double maximumZ = catchment.HorizontalVertices.Max(value => value.Z);
            foreach (KeyValuePair<string, double> side in new[]
            {
                new KeyValuePair<string, double>("south", minimumZ),
                new KeyValuePair<string, double>("north", maximumZ)
            })
            {
                surfaces.Add(new DungeonSurfacePlanV2(
                    "surface-rail-water-reservoir-moving-catchment-" + side.Key,
                    ModuleId(owner.Id),
                    owner.Id,
                    DungeonSurfaceKindV2.Rail,
                    BoxPrism(
                        minimumX,
                        maximumX,
                        catchment.MaximumY,
                        catchment.MaximumY + 2.4d,
                        side.Value - 0.12d,
                        side.Value + 0.12d),
                    "waterworks-safety-rail",
                    true,
                    false,
                    DungeonAccessPredicateV2.Always));
            }
        }

        private static void AddHorizontalRailSegments(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft draft,
            string side,
            double z,
            double openingWidth)
        {
            double center = (draft.Bounds.Minimum.X + draft.Bounds.Maximum.X) * 0.5d;
            AddHorizontalRail(surfaces, draft, side + "-a", z, draft.Bounds.Minimum.X, center - openingWidth * 0.5d);
            AddHorizontalRail(surfaces, draft, side + "-b", z, center + openingWidth * 0.5d, draft.Bounds.Maximum.X);
        }

        private static void AddHorizontalRail(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft draft,
            string suffix,
            double z,
            double minimumX,
            double maximumX)
        {
            if (maximumX - minimumX <= 0.1d) return;
            AddRail(surfaces, draft, suffix, minimumX, maximumX, z - 0.12d, z + 0.12d);
        }

        private static void AddVerticalRail(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft draft,
            string suffix,
            double x,
            double minimumZ,
            double maximumZ)
        {
            if (maximumZ - minimumZ <= 0.1d) return;
            AddRail(surfaces, draft, suffix, x - 0.12d, x + 0.12d, minimumZ, maximumZ);
        }

        private static void AddRail(
            ICollection<DungeonSurfacePlanV2> surfaces,
            RegionDraft draft,
            string suffix,
            double minimumX,
            double maximumX,
            double minimumZ,
            double maximumZ)
        {
            surfaces.Add(new DungeonSurfacePlanV2(
                "surface-rail-" + draft.Id + "-" + suffix,
                ModuleId(draft.Id),
                draft.Id,
                DungeonSurfaceKindV2.Rail,
                new DungeonConvexPrismV2(
                    new[]
                    {
                        new DungeonPoint2V2(minimumX, minimumZ),
                        new DungeonPoint2V2(maximumX, minimumZ),
                        new DungeonPoint2V2(maximumX, maximumZ),
                        new DungeonPoint2V2(minimumX, maximumZ)
                    },
                    draft.Bounds.Minimum.Y + 0.25d,
                    draft.Bounds.Minimum.Y + 2.65d),
                draft.DistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId
                    ? "waterworks-safety-rail"
                    : draft.DistrictId == IndustrialFactoryV2Ruleset.HazardDistrictId
                        ? "hazard-safety-rail"
                        : "factory-safety-rail",
                true,
                false,
                DungeonAccessPredicateV2.Always));
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

        private static DungeonConvexPrismV2 ReservoirMovingCatchmentPrism(
            RegionDraft reservoir,
            double minimumY,
            double maximumY)
        {
            double centerX = (reservoir.Bounds.Minimum.X + reservoir.Bounds.Maximum.X) * 0.5d;
            return BoxPrism(
                centerX - 6.25d,
                centerX + 6.25d,
                minimumY,
                maximumY,
                reservoir.Bounds.Minimum.Z,
                reservoir.Bounds.Maximum.Z);
        }

        private static string ModuleId(string regionId) => "module-" + regionId;
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
                MacroVariantIds = new string[MacroKinds.Length];
            }

            public IndustrialFactoryV2GenerationContext Context { get; }
            public DungeonBiomeDistrictKindV2 HazardKind { get; }
            public int MaximumBacktracks { get; }
            public string[] MacroVariantIds { get; }
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
                string templateId)
            {
                Id = id;
                MacroId = macroId;
                DistrictId = districtId;
                Stratum = stratum;
                Bounds = bounds;
                TemplateId = templateId;
            }

            public string Id { get; }
            public string MacroId { get; }
            public string DistrictId { get; }
            public DungeonElevationStratumV2 Stratum { get; }
            public DungeonBounds3 Bounds { get; }
            public string TemplateId { get; }
        }
    }
}
