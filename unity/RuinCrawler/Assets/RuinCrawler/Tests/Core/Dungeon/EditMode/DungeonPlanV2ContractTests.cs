using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class DungeonPlanV2ContractTests
    {
        [Test]
        public void PredicateEvaluatorUsesAnyOfAllOfAndTypedState()
        {
            var requiresKeyAndWater = new DungeonPredicateClauseV2(new[]
            {
                new DungeonPredicateConditionV2(
                    DungeonPredicateConditionKindV2.RequiredItem,
                    "credential-key",
                    DungeonPredicateOperatorV2.IsPresent),
                new DungeonPredicateConditionV2(
                    DungeonPredicateConditionKindV2.ControllerState,
                    "water-routing",
                    DungeonPredicateOperatorV2.Equals,
                    "StoredInReservoir")
            });
            var alreadyUnlocked = new DungeonPredicateClauseV2(new[]
            {
                new DungeonPredicateConditionV2(
                    DungeonPredicateConditionKindV2.ShortcutState,
                    "warehouse-return",
                    DungeonPredicateOperatorV2.IsPresent)
            });
            var predicate = new DungeonAccessPredicateV2(new[] { alreadyUnlocked, requiresKeyAndWater });
            DungeonPredicateStateV2 matching = State(
                items: new[] { "credential-key" },
                controllers: new[] { new DungeonControllerStateFactV2("water-routing", "StoredInReservoir") });
            DungeonPredicateStateV2 shortcut = State(shortcuts: new[] { "warehouse-return" });

            Assert.That(DungeonPredicateEvaluatorV2.Evaluate(predicate, matching), Is.True);
            Assert.That(DungeonPredicateEvaluatorV2.Evaluate(predicate, shortcut), Is.True);
            Assert.That(DungeonPredicateEvaluatorV2.Evaluate(predicate, State()), Is.False);
            Assert.That(DungeonPredicateEvaluatorV2.Evaluate(DungeonAccessPredicateV2.Always, State()), Is.True);
            Assert.That(DungeonPredicateEvaluatorV2.Evaluate(DungeonAccessPredicateV2.Never, State()), Is.False);
        }

        [Test]
        public void PredicateConditionRejectsFreeFormOperatorShape()
        {
            Assert.Throws<ArgumentException>(() => new DungeonPredicateConditionV2(
                DungeonPredicateConditionKindV2.ControllerState,
                "water-routing",
                DungeonPredicateOperatorV2.IsPresent));
            Assert.Throws<ArgumentException>(() => new DungeonPredicateConditionV2(
                DungeonPredicateConditionKindV2.RequiredItem,
                "credential-key",
                DungeonPredicateOperatorV2.Equals,
                "some-string"));
        }

        [Test]
        public void PredicateAndStateArraysAreCanonicalAndDetachedFromInputs()
        {
            var mutableItems = new List<string> { "z-key", "a-key" };
            DungeonPredicateStateV2 state = State(items: mutableItems);
            mutableItems.Clear();

            Assert.That(state.RequiredItemIds, Is.EqualTo(new[] { "a-key", "z-key" }));
            Assert.That(state.RequiredItemIds, Is.Not.InstanceOf<string[]>());
        }

        [Test]
        public void ConvexPrismRejectsConcaveOrDegenerateFootprints()
        {
            Assert.Throws<ArgumentException>(() => new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(0d, 0d),
                    new DungeonPoint2V2(2d, 0d),
                    new DungeonPoint2V2(1d, 0.5d),
                    new DungeonPoint2V2(2d, 2d),
                    new DungeonPoint2V2(0d, 2d)
                },
                0d,
                1d));
            Assert.Throws<ArgumentException>(() => new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(0d, 0d),
                    new DungeonPoint2V2(1d, 0d),
                    new DungeonPoint2V2(2d, 0d)
                },
                0d,
                1d));
        }

        [Test]
        public void ValidPlanCanonicalizesTopLevelArraysAndHasStableSignature()
        {
            DungeonPlanV2 first = BuildPlan(reverseInputs: false);
            DungeonPlanV2 second = BuildPlan(reverseInputs: true);

            Assert.That(first.MacroRoles.Select(value => value.Id),
                Is.EqualTo(first.MacroRoles.Select(value => value.Id).OrderBy(value => value, StringComparer.Ordinal)));
            Assert.That(first.Regions.Select(value => value.Id),
                Is.EqualTo(first.Regions.Select(value => value.Id).OrderBy(value => value, StringComparer.Ordinal)));
            Assert.That(first.Districts.Select(value => value.Id),
                Is.EqualTo(first.Districts.Select(value => value.Id).OrderBy(value => value, StringComparer.Ordinal)));
            Assert.That(first.DeterministicSignature, Is.EqualTo(second.DeterministicSignature));
            Assert.That(first, Is.EqualTo(second));
            Assert.That(first.GameplayBeats, Has.Count.EqualTo(DungeonPlanV2.RequiredGameplayBeatCount),
                "Seven is a gameplay-beat budget, not a fixed room or ownership-group count.");
            Assert.That(first.Modules.Count,
                Is.InRange(DungeonPlanV2.MinimumModuleCount, DungeonPlanV2.MaximumModuleCount));
            Assert.That(first.MacroRoles.SelectMany(value => value.ModuleInstanceIds),
                Is.EquivalentTo(first.Modules.Select(value => value.Id)),
                "Compatibility ownership groups must cover modules without defining route order.");
            Assert.That(first.Regions.Count, Is.EqualTo(12));
            Assert.That(first.Districts.Single(value => value.Kind == DungeonBiomeDistrictKindV2.Waterworks).RegionIds,
                Has.Count.EqualTo(3));
        }

        [Test]
        public void PlanRejectsUnknownDistrictReference()
        {
            Assert.Throws<ArgumentException>(() => BuildPlan(reverseInputs: false, corruptDistrictReference: true));
        }

        [Test]
        public void PlanRejectsMissingHazardDistrict()
        {
            Assert.Throws<ArgumentException>(() => BuildPlan(reverseInputs: false, replaceHazardWithFactory: true));
        }

        [Test]
        public void OrderedRouteEdgesRemainOrderedWhileMembershipArraysCanonicalize()
        {
            var exit = new DungeonAuthorizedExitPlanV2(
                "exit",
                "region-a",
                "region-b",
                DungeonAccessPredicateV2.Always);
            var route = new DungeonExplorationRoutePlanV2(
                "route",
                new[] { "edge-z", "edge-a" },
                DungeonRouteRoleV2.OptionalBranch,
                DungeonAccessPredicateV2.Always,
                new[] { exit },
                12d,
                0.25d,
                new[] { "discovery-z", "discovery-a" },
                DungeonReverseTraversalPolicyV2.Bidirectional,
                DungeonRevealPolicyV2.OnEntry);

            Assert.That(route.OrderedTraversalEdgeIds, Is.EqualTo(new[] { "edge-z", "edge-a" }));
            Assert.That(route.DiscoveryIds, Is.EqualTo(new[] { "discovery-a", "discovery-z" }));
        }

        [Test]
        public void EnvironmentSnapshotAndMapKnowledgeAreCanonicalPureState()
        {
            var snapshot = new DungeonEnvironmentSnapshotV2(
                new[]
                {
                    new DungeonControllerStateFactV2("z-controller", "on"),
                    new DungeonControllerStateFactV2("a-controller", "off")
                },
                new[]
                {
                    new DungeonFluidNetworkStateV2("waterworks", "FreightSumpFilled")
                },
                new[] { "z-shortcut", "a-shortcut" });
            var knowledge = new DungeonMapKnowledgeStateV2(
                new[]
                {
                    new DungeonRegionKnowledgeV2("z-region", DungeonMapKnowledgeLevelV2.Seen),
                    new DungeonRegionKnowledgeV2("a-region", DungeonMapKnowledgeLevelV2.Explored)
                },
                new[] { "edge-z", "edge-a" },
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>());

            Assert.That(snapshot.ControllerStates.Select(value => value.ControllerId),
                Is.EqualTo(new[] { "a-controller", "z-controller" }));
            Assert.That(snapshot.ActiveShortcutIds, Is.EqualTo(new[] { "a-shortcut", "z-shortcut" }));
            Assert.That(knowledge.Regions.Select(value => value.RegionId),
                Is.EqualTo(new[] { "a-region", "z-region" }));
            Assert.That(knowledge.DiscoveredTraversalEdgeIds, Is.EqualTo(new[] { "edge-a", "edge-z" }));
        }

        private static DungeonPredicateStateV2 State(
            IEnumerable<string> items = null,
            IEnumerable<DungeonControllerStateFactV2> controllers = null,
            IEnumerable<string> shortcuts = null)
        {
            return new DungeonPredicateStateV2(
                items ?? Array.Empty<string>(),
                controllers ?? Array.Empty<DungeonControllerStateFactV2>(),
                shortcuts ?? Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>());
        }

        private static DungeonPlanV2 BuildPlan(
            bool reverseInputs,
            bool corruptDistrictReference = false,
            bool replaceHazardWithFactory = false)
        {
            string[] factoryRegions = Enumerable.Range(0, 7).Select(index => "factory-" + index).ToArray();
            string[] waterRegions = Enumerable.Range(0, 3).Select(index => "water-" + index).ToArray();
            string[] hazardRegions = Enumerable.Range(0, 2).Select(index => "hazard-" + index).ToArray();
            string[] macroIds = Enumerable.Range(0, 7).Select(index => "macro-" + index).ToArray();

            var regionAssignments = new List<RegionAssignment>();
            for (int index = 0; index < factoryRegions.Length; index += 1)
            {
                regionAssignments.Add(new RegionAssignment(factoryRegions[index], macroIds[index], "district-factory"));
            }

            regionAssignments.Add(new RegionAssignment(waterRegions[0], macroIds[2], "district-waterworks"));
            regionAssignments.Add(new RegionAssignment(waterRegions[1], macroIds[3], "district-waterworks"));
            regionAssignments.Add(new RegionAssignment(waterRegions[2], macroIds[4], "district-waterworks"));
            regionAssignments.Add(new RegionAssignment(hazardRegions[0], macroIds[5], "district-hazard"));
            regionAssignments.Add(new RegionAssignment(hazardRegions[1], macroIds[6], "district-hazard"));

            var modules = new List<DungeonModuleInstancePlanV2>();
            var regions = new List<DungeonRegionPlanV2>();
            foreach (RegionAssignment assignment in regionAssignments)
            {
                string moduleId = "module-" + assignment.RegionId;
                DungeonBounds3 bounds = BoundsAt(regions.Count * 4d);
                modules.Add(new DungeonModuleInstancePlanV2(
                    moduleId,
                    "template-" + assignment.RegionId,
                    "hash-v1-" + assignment.RegionId,
                    assignment.MacroId,
                    bounds,
                    new[] { assignment.RegionId },
                    Array.Empty<string>(),
                    Array.Empty<string>()));
                regions.Add(new DungeonRegionPlanV2(
                    assignment.RegionId,
                    assignment.MacroId,
                    new[] { moduleId },
                    bounds,
                    assignment.RegionId.StartsWith("factory", StringComparison.Ordinal)
                        ? DungeonElevationStratumV2.Entry
                        : DungeonElevationStratumV2.Lower,
                    corruptDistrictReference && assignment.RegionId == "factory-0"
                        ? "missing-district"
                        : assignment.DistrictId,
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    Array.Empty<string>(),
                    new[] { new DungeonEnvironmentSupportPlanV2("support-" + assignment.RegionId, DungeonAccessPredicateV2.Always) },
                    "nav-" + assignment.RegionId));
            }

            DungeonMacroRoleKindV2[] roleKinds =
            {
                DungeonMacroRoleKindV2.SecurityEntrance,
                DungeonMacroRoleKindV2.AssemblyFloor,
                DungeonMacroRoleKindV2.BrokenFreightShaft,
                DungeonMacroRoleKindV2.SortingGantry,
                DungeonMacroRoleKindV2.NestWarehouse,
                DungeonMacroRoleKindV2.CredentialTower,
                DungeonMacroRoleKindV2.MachineCore
            };
            var macros = new List<DungeonMacroRolePlanV2>();
            for (int index = 0; index < macroIds.Length; index += 1)
            {
                string macroId = macroIds[index];
                macros.Add(new DungeonMacroRolePlanV2(
                    macroId,
                    roleKinds[index],
                    modules.Where(module => module.MacroRoleId == macroId).Select(module => module.Id)));
            }

            var districts = new List<DungeonBiomeDistrictPlanV2>
            {
                District("district-factory", DungeonBiomeDistrictKindV2.Factory, factoryRegions),
                District("district-waterworks", DungeonBiomeDistrictKindV2.Waterworks, waterRegions),
                District(
                    "district-hazard",
                    replaceHazardWithFactory ? DungeonBiomeDistrictKindV2.Factory : DungeonBiomeDistrictKindV2.MagmaUndercroft,
                    hazardRegions)
            };

            var gameplayBeats = new[]
            {
                Beat("beat-security", DungeonGameplayBeatKindV2.SecurityEntrance),
                Beat("beat-assembly", DungeonGameplayBeatKindV2.AssemblyFloor, "beat-security"),
                Beat("beat-freight", DungeonGameplayBeatKindV2.BrokenFreightShaft, "beat-assembly"),
                Beat("beat-nest", DungeonGameplayBeatKindV2.NestWarehouse, "beat-assembly"),
                Beat("beat-sorting", DungeonGameplayBeatKindV2.SortingGantry, "beat-freight", "beat-nest"),
                Beat("beat-credential", DungeonGameplayBeatKindV2.CredentialTower, "beat-sorting"),
                Beat("beat-core", DungeonGameplayBeatKindV2.MachineCore, "beat-credential")
            };
            var graph = new DungeonAbstractRouteGraphV2(
                modules.Select(module => new DungeonAbstractRouteNodeV2(
                    module.Id,
                    DistrictKindForRegion(
                        regions.Single(region => region.ModuleInstanceIds.Contains(module.Id)),
                        districts),
                    transitionOnly: false)),
                Array.Empty<DungeonAbstractRouteEdgeV2>());
            var beatAssignments = gameplayBeats.Select(beat =>
            {
                DungeonMacroRoleKindV2 role = RoleForBeat(beat.Kind);
                string macroId = macroIds[Array.IndexOf(roleKinds, role)];
                return new DungeonGameplayBeatAssignmentV2(
                    beat.Id,
                    modules.Where(module => module.MacroRoleId == macroId).Select(module => module.Id));
            }).ToArray();

            if (reverseInputs)
            {
                macros.Reverse();
                modules.Reverse();
                regions.Reverse();
                districts.Reverse();
            }

            return new DungeonPlanV2(
                DungeonPlanV2.CurrentSchemaVersion,
                IndustrialFactoryV2Ruleset.ContractVersion,
                "industrial-factory-v2",
                "industrial-factory-v2",
                "contracts-v1",
                "seed",
                "seed/attempt/0",
                0,
                1,
                "factory-0",
                "factory-6",
                new DungeonBounds3(new DungeonPoint3(-10d, -20d, -10d), new DungeonPoint3(60d, 20d, 10d)),
                DungeonVoidPolicyV2.Prohibited,
                macros,
                modules,
                Array.Empty<DungeonModuleConnectorPlanV2>(),
                Array.Empty<DungeonAnchorPlanV2>(),
                regions,
                districts,
                Array.Empty<DungeonTraversalEdgePlanV2>(),
                Array.Empty<DungeonExplorationRoutePlanV2>(),
                Array.Empty<DungeonDiscoveryPlanV2>(),
                Array.Empty<DungeonShortcutPlanV2>(),
                Array.Empty<DungeonSurfacePlanV2>(),
                Array.Empty<DungeonFluidZonePlanV2>(),
                Array.Empty<DungeonFluidNetworkPlanV2>(),
                Array.Empty<DungeonEnvironmentControllerPlanV2>(),
                Array.Empty<DungeonFallCatchmentPlanV2>(),
                Array.Empty<DungeonFallExposurePlanV2>(),
                gameplayBeats,
                graph,
                beatAssignments,
                Array.Empty<DungeonMiniDungeonCompositionGrammarV2>());
        }

        private static DungeonGameplayBeatPlanV2 Beat(
            string id,
            DungeonGameplayBeatKindV2 kind,
            params string[] prerequisites) =>
            new DungeonGameplayBeatPlanV2(id, kind, prerequisites);

        private static DungeonBiomeDistrictKindV2 DistrictKindForRegion(
            DungeonRegionPlanV2 region,
            IEnumerable<DungeonBiomeDistrictPlanV2> districts) =>
            districts.Single(district => district.RegionIds.Contains(region.Id)).Kind;

        private static DungeonMacroRoleKindV2 RoleForBeat(DungeonGameplayBeatKindV2 beat)
        {
            switch (beat)
            {
                case DungeonGameplayBeatKindV2.SecurityEntrance:
                    return DungeonMacroRoleKindV2.SecurityEntrance;
                case DungeonGameplayBeatKindV2.AssemblyFloor:
                    return DungeonMacroRoleKindV2.AssemblyFloor;
                case DungeonGameplayBeatKindV2.BrokenFreightShaft:
                    return DungeonMacroRoleKindV2.BrokenFreightShaft;
                case DungeonGameplayBeatKindV2.SortingGantry:
                    return DungeonMacroRoleKindV2.SortingGantry;
                case DungeonGameplayBeatKindV2.NestWarehouse:
                    return DungeonMacroRoleKindV2.NestWarehouse;
                case DungeonGameplayBeatKindV2.CredentialTower:
                    return DungeonMacroRoleKindV2.CredentialTower;
                case DungeonGameplayBeatKindV2.MachineCore:
                    return DungeonMacroRoleKindV2.MachineCore;
                default:
                    throw new ArgumentOutOfRangeException(nameof(beat), beat, "Unknown gameplay beat.");
            }
        }

        private static DungeonBiomeDistrictPlanV2 District(
            string id,
            DungeonBiomeDistrictKindV2 kind,
            IEnumerable<string> regionIds)
        {
            return new DungeonBiomeDistrictPlanV2(
                id,
                kind,
                regionIds,
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>(),
                Array.Empty<string>(),
                "landmark-profile",
                "reward-profile",
                "audio-profile",
                "lighting-profile",
                "minimap-profile",
                0,
                0,
                0,
                Array.Empty<string>());
        }

        private static DungeonBounds3 BoundsAt(double x)
        {
            return new DungeonBounds3(
                new DungeonPoint3(x, -2d, -2d),
                new DungeonPoint3(x + 3d, 3d, 2d));
        }

        private sealed class RegionAssignment
        {
            public RegionAssignment(string regionId, string macroId, string districtId)
            {
                RegionId = regionId;
                MacroId = macroId;
                DistrictId = districtId;
            }

            public string RegionId { get; }
            public string MacroId { get; }
            public string DistrictId { get; }
        }
    }
}
