using System;

namespace RuinCrawler.Core.Buster.Tests
{
    internal static class BusterTestPlans
    {
        public static CompiledBusterPlan Pulse(
            string buildId = "build-a",
            int revision = 1,
            BusterTuning tuning = null)
        {
            return BusterCompiler.Compile(new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                buildId,
                "fixture:" + buildId + ":chassis",
                tuning ?? new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource(
                    "pulse",
                    new[]
                    {
                        new BusterNodeSource("pulse", "pulseBolt", "fixture:" + buildId + ":pulse")
                    },
                    Array.Empty<BusterEdgeSource>()),
                revision));
        }

        public static CompiledBusterPlan PulseSpreadExplosion(
            string buildId = "spread-explosion",
            int revision = 1)
        {
            return BusterCompiler.Compile(new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                buildId,
                "fixture:" + buildId + ":chassis",
                new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource(
                    "pulse",
                    new[]
                    {
                        new BusterNodeSource("pulse", "pulseBolt", "fixture:" + buildId + ":pulse"),
                        new BusterNodeSource("spread", "spread3", "fixture:" + buildId + ":spread"),
                        new BusterNodeSource("payload", "explosion", "fixture:" + buildId + ":payload")
                    },
                    new[]
                    {
                        new BusterEdgeSource("pulse", BusterEdgePorts.Next, "spread"),
                        new BusterEdgeSource("spread", BusterEdgePorts.Next, "payload")
                    }),
                revision));
        }

        public static CompiledBusterPlan ApexClusterExplosion(
            string buildId = "unity-apex-cluster",
            int revision = 7)
        {
            return BusterCompiler.Compile(new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                buildId,
                "fixture:" + buildId + ":chassis",
                new BusterTuning(6, 4, 3, 3),
                new BusterProgramSource(
                    "mortar",
                    new[]
                    {
                        new BusterNodeSource("mortar", "mortarShell", "fixture:" + buildId + ":mortar"),
                        new BusterNodeSource("apex", "atApex", "fixture:" + buildId + ":apex"),
                        new BusterNodeSource("cluster", "cluster5", "fixture:" + buildId + ":cluster"),
                        new BusterNodeSource("explosion", "explosion", "fixture:" + buildId + ":explosion")
                    },
                    new[]
                    {
                        new BusterEdgeSource("mortar", BusterEdgePorts.Next, "apex"),
                        new BusterEdgeSource("apex", BusterEdgePorts.Child, "cluster"),
                        new BusterEdgeSource("cluster", BusterEdgePorts.Next, "explosion")
                    }),
                revision));
        }
    }
}
