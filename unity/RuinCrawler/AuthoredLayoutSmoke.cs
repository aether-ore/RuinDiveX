using System;
using System.Linq;
using System.Reflection;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;

internal static class AuthoredLayoutSmoke
{
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "gate") return RunGraphGate();
        int failures = 0;
        int count = args.Length > 0 ? int.Parse(args[0]) : 20;
        for (int index = 0; index < count; index += 1)
        {
            string seed = "safety-smoke-" + index;
            var layoutRandom = new DungeonDeterministicRandom(seed + ":candidate:0:authored-layout");
            int template = layoutRandom.RangeInclusive(0, 5);
            bool surveillance = template != 5 && layoutRandom.Chance(0.5d);
            DungeonBiomeDistrictKindV2 hazardKind = (DungeonDeterministicRandom.HashSeed(seed) & 1u) == 0u
                ? DungeonBiomeDistrictKindV2.MagmaUndercroft
                : DungeonBiomeDistrictKindV2.ElectricalUndercroft;
            var context = new IndustrialFactoryV2GenerationContext(seed, seed + ":attempt:1", 1, 1);
            var generator = new IndustrialFactoryV2Generator();
            DungeonPlanV2 plan;
            try
            {
                plan = (DungeonPlanV2)typeof(IndustrialFactoryV2Generator)
                    .GetMethod("BuildCandidate", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(generator, new object[] { context, seed + ":candidate:0", hazardKind, 255 });
            }
            catch (TargetInvocationException exception)
            {
                failures += 1;
                Console.WriteLine("FAIL " + seed + " template=" + template + " surveillance=" + surveillance);
                Console.WriteLine("  BUILD: " + exception.InnerException);
                continue;
            }

            IndustrialFactoryV2ValidationResult validation = new IndustrialFactoryV2Validator().Validate(plan);
            if (validation.Accepted)
            {
                Console.WriteLine("OK " + seed + " template=" + template + " surveillance=" + surveillance + " modules=" + plan.Modules.Count
                    + " regions=" + plan.Regions.Count);
                continue;
            }

            failures += 1;
            Console.WriteLine("FAIL " + seed + " template=" + template + " surveillance=" + surveillance);
            foreach (IndustrialFactoryV2ValidationIssue issue in validation.Errors)
            {
                Console.WriteLine("  " + issue.Code + " " + issue.Path + ": " + issue.Message);
            }
        }

        return failures == 0 ? 0 : 1;
    }

    private static int RunGraphGate()
    {
        var topologies = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
        var incidence = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
        bool split = false;
        bool shared = false;
        for (int index = 0; index < 1000; index += 1)
        {
            string seed = "authored-graph-gate-" + index;
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator(Accept.Instance).Generate(seed);
            if (plan.Modules.Count < 8 || plan.Modules.Count > 14 || plan.Regions.Count < 12 || plan.Regions.Count > 18)
                throw new InvalidOperationException("Budget failure: " + seed);
            topologies.Add(string.Join("|", plan.AbstractRouteGraph.Edges
                .Where(value => value.Role == DungeonAbstractRouteEdgeRoleV2.Critical || value.Role == DungeonAbstractRouteEdgeRoleV2.Optional)
                .Select(value => value.FromNodeId.Substring(value.FromNodeId.LastIndexOf('-') + 1) + ">" + value.ToNodeId.Substring(value.ToNodeId.LastIndexOf('-') + 1))
                .OrderBy(value => value, StringComparer.Ordinal)));
            incidence.Add(string.Join("|", plan.BeatAssignments.OrderBy(value => value.BeatId, StringComparer.Ordinal)
                .Select(value => value.BeatId + "=" + value.ModuleInstanceIds.Count)));
            string sortingId = plan.GameplayBeats.Single(value => value.Kind == DungeonGameplayBeatKindV2.SortingGantry).Id;
            split |= plan.BeatAssignments.Single(value => value.BeatId == sortingId).ModuleInstanceIds.Count > 1;
            shared |= plan.Modules.Any(module => plan.BeatAssignments.Count(value => value.ModuleInstanceIds.Contains(module.Id)) > 1);
        }
        Console.WriteLine("GATE OK seeds=1000 topologies=" + topologies.Count + " incidence=" + incidence.Count
            + " split=" + split + " shared=" + shared);
        return topologies.Count >= 3 && incidence.Count >= 2 && split && shared ? 0 : 1;
    }

    private sealed class Accept : IIndustrialFactoryV2CandidateValidator
    {
        public static readonly Accept Instance = new Accept();
        public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan) =>
            new IndustrialFactoryV2ValidationResult(Array.Empty<IndustrialFactoryV2ValidationIssue>());
    }
}
