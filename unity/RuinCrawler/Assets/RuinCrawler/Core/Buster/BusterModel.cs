using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public sealed class BusterTuning
    {
        public BusterTuning(int power, int energy, int range, int rapid)
        {
            Power = power;
            Energy = energy;
            Range = range;
            Rapid = rapid;
        }

        public int Power { get; }
        public int Energy { get; }
        public int Range { get; }
        public int Rapid { get; }

        public int Total => Power + Energy + Range + Rapid;
    }

    public sealed class BusterNodeSource
    {
        public BusterNodeSource(string nodeId, string moduleId, string moduleInstanceId = null)
        {
            NodeId = nodeId;
            ModuleId = moduleId;
            ModuleInstanceId = moduleInstanceId;
        }

        public string NodeId { get; }
        public string ModuleId { get; }
        public string ModuleInstanceId { get; }
    }

    public static class BusterEdgePorts
    {
        public const string Next = "next";
        public const string Child = "child";

        public static bool IsKnown(string value)
        {
            return string.Equals(value, Next, StringComparison.Ordinal)
                || string.Equals(value, Child, StringComparison.Ordinal);
        }
    }

    public sealed class BusterEdgeSource
    {
        public BusterEdgeSource(string from, string port, string to)
        {
            From = from;
            Port = port;
            To = to;
        }

        public string From { get; }
        public string Port { get; }
        public string To { get; }
    }

    public sealed class BusterProgramSource
    {
        public BusterProgramSource(
            string rootNodeId,
            IEnumerable<BusterNodeSource> nodes,
            IEnumerable<BusterEdgeSource> edges)
        {
            RootNodeId = rootNodeId;
            Nodes = Array.AsReadOnly(new List<BusterNodeSource>(nodes ?? Array.Empty<BusterNodeSource>()).ToArray());
            Edges = Array.AsReadOnly(new List<BusterEdgeSource>(edges ?? Array.Empty<BusterEdgeSource>()).ToArray());
        }

        public string RootNodeId { get; }
        public IReadOnlyList<BusterNodeSource> Nodes { get; }
        public IReadOnlyList<BusterEdgeSource> Edges { get; }
    }

    public sealed class BusterBuildSource
    {
        public BusterBuildSource(
            int schemaVersion,
            string rulesetVersion,
            string buildId,
            string chassisId,
            BusterTuning tuning,
            BusterProgramSource program,
            int revision = 0)
        {
            SchemaVersion = schemaVersion;
            RulesetVersion = rulesetVersion;
            BuildId = buildId;
            ChassisId = chassisId;
            Tuning = tuning;
            Program = program;
            Revision = revision < 0 ? 0 : revision;
        }

        public int SchemaVersion { get; }
        public string RulesetVersion { get; }
        public string BuildId { get; }
        public string ChassisId { get; }
        public BusterTuning Tuning { get; }
        public BusterProgramSource Program { get; }
        public int Revision { get; }

        public static BusterBuildSource CreateEmpty(
            string buildId = "custom-buster",
            string chassisId = "custom-buster-chassis",
            BusterTuning tuning = null)
        {
            return new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                buildId,
                chassisId,
                tuning ?? new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource(null, Array.Empty<BusterNodeSource>(), Array.Empty<BusterEdgeSource>()));
        }

        public static BusterBuildSource Normalize(BusterBuildSource source)
        {
            if (source == null)
            {
                return new BusterBuildSource(
                    0,
                    null,
                    null,
                    null,
                    null,
                    new BusterProgramSource(null, Array.Empty<BusterNodeSource>(), Array.Empty<BusterEdgeSource>()));
            }

            var nodes = new List<BusterNodeSource>();
            var edges = new List<BusterEdgeSource>();
            if (source.Program != null)
            {
                for (int index = 0; index < source.Program.Nodes.Count; index += 1)
                {
                    BusterNodeSource node = source.Program.Nodes[index];
                    nodes.Add(node == null
                        ? new BusterNodeSource(null, null, null)
                        : new BusterNodeSource(node.NodeId, node.ModuleId, node.ModuleInstanceId));
                }

                for (int index = 0; index < source.Program.Edges.Count; index += 1)
                {
                    BusterEdgeSource edge = source.Program.Edges[index];
                    edges.Add(edge == null
                        ? new BusterEdgeSource(null, null, null)
                        : new BusterEdgeSource(edge.From, edge.Port, edge.To));
                }
            }

            nodes.Sort(CompareNodes);
            edges.Sort(CompareEdges);
            BusterTuning tuning = source.Tuning == null
                ? null
                : new BusterTuning(
                    source.Tuning.Power,
                    source.Tuning.Energy,
                    source.Tuning.Range,
                    source.Tuning.Rapid);
            return new BusterBuildSource(
                source.SchemaVersion,
                source.RulesetVersion,
                source.BuildId,
                source.ChassisId,
                tuning,
                new BusterProgramSource(source.Program?.RootNodeId, nodes, edges),
                source.Revision);
        }

        private static int CompareNodes(BusterNodeSource left, BusterNodeSource right)
        {
            int result = CompareText(left?.NodeId, right?.NodeId);
            if (result != 0)
            {
                return result;
            }

            result = CompareText(left?.ModuleId, right?.ModuleId);
            return result != 0
                ? result
                : CompareText(left?.ModuleInstanceId, right?.ModuleInstanceId);
        }

        private static int CompareEdges(BusterEdgeSource left, BusterEdgeSource right)
        {
            int result = CompareText(left?.From, right?.From);
            if (result != 0)
            {
                return result;
            }

            result = PortRank(left?.Port).CompareTo(PortRank(right?.Port));
            if (result != 0)
            {
                return result;
            }

            result = CompareText(left?.Port, right?.Port);
            return result != 0 ? result : CompareText(left?.To, right?.To);
        }

        private static int PortRank(string port)
        {
            if (string.Equals(port, BusterEdgePorts.Next, StringComparison.Ordinal))
            {
                return 0;
            }

            if (string.Equals(port, BusterEdgePorts.Child, StringComparison.Ordinal))
            {
                return 1;
            }

            return 2;
        }

        private static int CompareText(string left, string right)
        {
            return string.Compare(left ?? string.Empty, right ?? string.Empty, StringComparison.Ordinal);
        }
    }
}
