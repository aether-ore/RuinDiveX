using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public sealed class BusterValidationIssue
    {
        public BusterValidationIssue(string code, string path, string moduleId, string message)
        {
            Code = code;
            Path = path;
            ModuleId = moduleId;
            Message = message;
        }

        public string Code { get; }
        public string Path { get; }
        public string ModuleId { get; }
        public string Message { get; }
    }

    public sealed class BusterValidationContext
    {
        public BusterValidationContext(
            IEnumerable<string> ownedModuleInstanceIds = null,
            IEnumerable<string> claimedModuleInstanceIds = null)
        {
            OwnedModuleInstanceIds = ownedModuleInstanceIds == null
                ? null
                : new HashSet<string>(ownedModuleInstanceIds, StringComparer.Ordinal);
            ClaimedModuleInstanceIds = claimedModuleInstanceIds == null
                ? null
                : new HashSet<string>(claimedModuleInstanceIds, StringComparer.Ordinal);
        }

        public IReadOnlyCollection<string> OwnedModuleInstanceIds { get; }
        public IReadOnlyCollection<string> ClaimedModuleInstanceIds { get; }
    }

    public sealed class BusterValidationResult
    {
        internal BusterValidationResult(
            IList<BusterValidationIssue> errors,
            IList<BusterValidationIssue> warnings,
            int semanticCapacityUsed,
            BusterBuildSource normalizedBuild)
        {
            Errors = Array.AsReadOnly(new List<BusterValidationIssue>(errors).ToArray());
            Warnings = Array.AsReadOnly(new List<BusterValidationIssue>(warnings).ToArray());
            SemanticCapacityUsed = semanticCapacityUsed;
            NormalizedBuild = normalizedBuild;
        }

        public bool IsValid => Errors.Count == 0;
        public bool Ok => IsValid;
        public IReadOnlyList<BusterValidationIssue> Errors { get; }
        public IReadOnlyList<BusterValidationIssue> Warnings { get; }
        public int SemanticCapacityUsed { get; }
        public BusterBuildSource NormalizedBuild { get; }
    }

    public static class BusterValidator
    {
        private sealed class IndexedEdge
        {
            public IndexedEdge(BusterEdgeSource edge, int index)
            {
                Edge = edge;
                Index = index;
            }

            public BusterEdgeSource Edge { get; }
            public int Index { get; }
        }

        private sealed class KnownNode
        {
            public KnownNode(BusterNodeSource node, int index, BusterModuleDefinition definition)
            {
                Node = node;
                Index = index;
                Definition = definition;
            }

            public BusterNodeSource Node { get; }
            public int Index { get; }
            public BusterModuleDefinition Definition { get; }
        }

        public static BusterValidationResult ValidateProgram(BusterBuildSource build)
        {
            return ValidateSource(build, null, false);
        }

        public static BusterValidationResult ValidateBuild(
            BusterBuildSource build,
            BusterValidationContext context = null)
        {
            return ValidateSource(build, context, true);
        }

        private static BusterValidationResult ValidateSource(
            BusterBuildSource build,
            BusterValidationContext context,
            bool validatePhysical)
        {
            var errors = new List<BusterValidationIssue>();
            var warnings = new List<BusterValidationIssue>();
            var seenErrors = new HashSet<string>(StringComparer.Ordinal);
            var seenWarnings = new HashSet<string>(StringComparer.Ordinal);

            Action<string, string, string, string> fail = (code, path, moduleId, message) =>
                AddIssue(errors, seenErrors, code, path, moduleId, message);
            Action<string, string, string, string> warn = (code, path, moduleId, message) =>
                AddIssue(warnings, seenWarnings, code, path, moduleId, message);

            if (build == null)
            {
                fail("INVALID_BUILD", string.Empty, null, "A Custom Buster build must be supplied.");
                return new BusterValidationResult(errors, warnings, 0, BusterBuildSource.Normalize(null));
            }

            if (build.SchemaVersion != BusterRuleset.SchemaVersion)
            {
                fail("UNSUPPORTED_SCHEMA_VERSION", "/schemaVersion", null,
                    $"Schema version must be {BusterRuleset.SchemaVersion}.");
            }

            if (!string.Equals(build.RulesetVersion, BusterRuleset.RulesetVersion, StringComparison.Ordinal))
            {
                fail("UNSUPPORTED_RULESET_VERSION", "/rulesetVersion", null,
                    $"Ruleset version must be \"{BusterRuleset.RulesetVersion}\".");
            }

            if (!IsNonEmpty(build.BuildId))
            {
                fail("INVALID_BUILD_ID", "/buildId", null, "buildId must be a non-empty string.");
            }

            if (!IsNonEmpty(build.ChassisId))
            {
                fail("INVALID_CHASSIS_ID", "/chassisId", null, "chassisId must be a non-empty string.");
            }

            bool tuningValid = ValidateTuning(build.Tuning, fail);
            BusterProgramSource program = build.Program;
            if (program == null)
            {
                fail("INVALID_PROGRAM", "/program", null, "program must be supplied.");
                program = new BusterProgramSource(null, Array.Empty<BusterNodeSource>(), Array.Empty<BusterEdgeSource>());
            }

            if (!IsNonEmpty(program.RootNodeId))
            {
                fail("INVALID_ROOT_NODE", "/program/rootNodeId", null, "rootNodeId must be a non-empty string.");
            }

            var nodeById = new Dictionary<string, BusterNodeSource>(StringComparer.Ordinal);
            var nodeIndexById = new Dictionary<string, int>(StringComparer.Ordinal);
            var moduleByNodeId = new Dictionary<string, BusterModuleDefinition>(StringComparer.Ordinal);
            var instanceIdOwners = new Dictionary<string, int>(StringComparer.Ordinal);
            var knownNodes = new List<KnownNode>();

            for (int index = 0; index < program.Nodes.Count; index += 1)
            {
                BusterNodeSource node = program.Nodes[index];
                if (node == null)
                {
                    fail("INVALID_NODE", NodePath(index), null, "Every program node must be supplied.");
                    continue;
                }

                string moduleId = node.ModuleId;
                if (!IsNonEmpty(node.NodeId))
                {
                    fail("INVALID_NODE_ID", NodePath(index, "/nodeId"), moduleId,
                        "nodeId must be a non-empty string.");
                }
                else if (nodeById.ContainsKey(node.NodeId))
                {
                    fail("DUPLICATE_NODE_ID", NodePath(index, "/nodeId"), moduleId,
                        $"Duplicate nodeId \"{node.NodeId}\".");
                }
                else
                {
                    nodeById.Add(node.NodeId, node);
                    nodeIndexById.Add(node.NodeId, index);
                }

                BusterModuleDefinition definition;
                if (!IsNonEmpty(moduleId))
                {
                    fail("INVALID_MODULE_ID", NodePath(index, "/moduleId"), moduleId,
                        "moduleId must be a non-empty string.");
                }
                else if (!BusterModuleCatalog.TryGet(moduleId, out definition))
                {
                    fail("UNKNOWN_MODULE", NodePath(index, "/moduleId"), moduleId,
                        $"Unknown Custom Buster module \"{moduleId}\".");
                }
                else
                {
                    knownNodes.Add(new KnownNode(node, index, definition));
                    if (IsNonEmpty(node.NodeId) && !moduleByNodeId.ContainsKey(node.NodeId))
                    {
                        moduleByNodeId.Add(node.NodeId, definition);
                    }
                }

                if (node.ModuleInstanceId != null && !IsNonEmpty(node.ModuleInstanceId))
                {
                    fail("INVALID_MODULE_INSTANCE_ID", NodePath(index, "/moduleInstanceId"), moduleId,
                        "moduleInstanceId must be a non-empty string when supplied.");
                }
                else if (IsNonEmpty(node.ModuleInstanceId))
                {
                    if (instanceIdOwners.ContainsKey(node.ModuleInstanceId))
                    {
                        fail("DUPLICATE_MODULE_INSTANCE", NodePath(index, "/moduleInstanceId"), moduleId,
                            $"Module instance \"{node.ModuleInstanceId}\" is mounted more than once.");
                    }
                    else
                    {
                        instanceIdOwners.Add(node.ModuleInstanceId, index);
                    }
                }
            }

            if (IsNonEmpty(program.RootNodeId) && !nodeById.ContainsKey(program.RootNodeId))
            {
                fail("ROOT_NODE_MISSING", "/program/rootNodeId", null,
                    $"Root node \"{program.RootNodeId}\" does not exist.");
            }

            var outgoing = new Dictionary<string, Dictionary<string, List<IndexedEdge>>>(StringComparer.Ordinal);
            var incoming = new Dictionary<string, List<IndexedEdge>>(StringComparer.Ordinal);
            var exactEdges = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < program.Edges.Count; index += 1)
            {
                BusterEdgeSource edge = program.Edges[index];
                if (edge == null)
                {
                    fail("INVALID_EDGE", EdgePath(index), null, "Every program edge must be supplied.");
                    continue;
                }

                bool fromValid = IsNonEmpty(edge.From) && nodeById.ContainsKey(edge.From);
                bool toValid = IsNonEmpty(edge.To) && nodeById.ContainsKey(edge.To);
                if (!IsNonEmpty(edge.From))
                {
                    fail("INVALID_EDGE_NODE", EdgePath(index, "/from"), null,
                        "Edge from must be a non-empty node id.");
                }
                else if (!fromValid)
                {
                    fail("EDGE_NODE_MISSING", EdgePath(index, "/from"), null,
                        $"Edge source \"{edge.From}\" does not exist.");
                }

                if (!IsNonEmpty(edge.To))
                {
                    fail("INVALID_EDGE_NODE", EdgePath(index, "/to"), null,
                        "Edge to must be a non-empty node id.");
                }
                else if (!toValid)
                {
                    fail("EDGE_NODE_MISSING", EdgePath(index, "/to"), null,
                        $"Edge target \"{edge.To}\" does not exist.");
                }

                if (!BusterEdgePorts.IsKnown(edge.Port))
                {
                    fail("INVALID_EDGE_PORT", EdgePath(index, "/port"), null,
                        "Edge port must be either \"next\" or \"child\".");
                }

                if (!fromValid || !toValid || !BusterEdgePorts.IsKnown(edge.Port))
                {
                    continue;
                }

                string exactKey = edge.From + "\0" + edge.Port + "\0" + edge.To;
                string fromModuleId = GetDefinition(moduleByNodeId, edge.From)?.Id;
                if (!exactEdges.Add(exactKey))
                {
                    fail("DUPLICATE_EDGE", EdgePath(index), fromModuleId,
                        "The same graph edge appears more than once.");
                }

                Dictionary<string, List<IndexedEdge>> portMap;
                if (!outgoing.TryGetValue(edge.From, out portMap))
                {
                    portMap = new Dictionary<string, List<IndexedEdge>>(StringComparer.Ordinal);
                    outgoing.Add(edge.From, portMap);
                }

                List<IndexedEdge> portEdges;
                if (!portMap.TryGetValue(edge.Port, out portEdges))
                {
                    portEdges = new List<IndexedEdge>();
                    portMap.Add(edge.Port, portEdges);
                }

                var indexedEdge = new IndexedEdge(edge, index);
                portEdges.Add(indexedEdge);
                if (portEdges.Count > 1)
                {
                    fail("MULTIPLE_PORT_EDGES", EdgePath(index, "/port"), fromModuleId,
                        $"Node \"{edge.From}\" has more than one {edge.Port} edge.");
                }

                List<IndexedEdge> incomingEdges;
                if (!incoming.TryGetValue(edge.To, out incomingEdges))
                {
                    incomingEdges = new List<IndexedEdge>();
                    incoming.Add(edge.To, incomingEdges);
                }

                incomingEdges.Add(indexedEdge);
                if (incomingEdges.Count > 1)
                {
                    fail("MULTIPLE_INCOMING_EDGES", EdgePath(index, "/to"),
                        GetDefinition(moduleByNodeId, edge.To)?.Id,
                        $"Node \"{edge.To}\" has more than one incoming edge.");
                }
            }

            List<IndexedEdge> rootIncoming;
            if (IsNonEmpty(program.RootNodeId)
                && incoming.TryGetValue(program.RootNodeId, out rootIncoming)
                && rootIncoming.Count > 0)
            {
                fail("ROOT_HAS_INCOMING_EDGE", "/program/rootNodeId",
                    GetDefinition(moduleByNodeId, program.RootNodeId)?.Id,
                    "The root node cannot have an incoming edge.");
            }

            if (HasCycle(nodeById.Keys, outgoing))
            {
                fail("CYCLE", "/program/edges", null, "The Custom Buster program must be acyclic.");
            }

            HashSet<string> reachable = FindReachable(program.RootNodeId, nodeById, outgoing);
            for (int index = 0; index < program.Nodes.Count; index += 1)
            {
                BusterNodeSource node = program.Nodes[index];
                if (node != null && IsNonEmpty(node.NodeId)
                    && nodeById.TryGetValue(node.NodeId, out BusterNodeSource canonical)
                    && ReferenceEquals(canonical, node)
                    && !reachable.Contains(node.NodeId))
                {
                    fail("DISCONNECTED", NodePath(index), node.ModuleId,
                        $"Node \"{node.NodeId}\" is not reachable from the root.");
                }
            }

            int semanticCapacityUsed = 0;
            for (int index = 0; index < knownNodes.Count; index += 1)
            {
                KnownNode entry = knownNodes[index];
                semanticCapacityUsed += entry.Definition.SemanticCapacity;
                if (validatePhysical && entry.Definition.Physical && !IsNonEmpty(entry.Node.ModuleInstanceId))
                {
                    fail("MODULE_INSTANCE_REQUIRED", NodePath(entry.Index, "/moduleInstanceId"), entry.Definition.Id,
                        $"{entry.Definition.Label} requires a physical module instance.");
                }
            }

            if (semanticCapacityUsed > BusterRuleset.ChassisCapacity)
            {
                fail("CAPACITY_EXCEEDED", "/program/nodes", null,
                    $"Program modules use {semanticCapacityUsed} of {BusterRuleset.ChassisCapacity} semantic capacity points.");
            }

            List<KnownNode> emitters = FindByKind(knownNodes, BusterModuleKind.Emitter);
            if (emitters.Count != 1)
            {
                fail("ONE_EMITTER_REQUIRED", "/program/nodes", null,
                    $"A program must contain exactly one emitter; found {emitters.Count}.");
            }

            BusterModuleDefinition rootDefinition = GetDefinition(moduleByNodeId, program.RootNodeId);
            if (nodeById.ContainsKey(program.RootNodeId ?? string.Empty)
                && rootDefinition != null
                && rootDefinition.Kind != BusterModuleKind.Emitter)
            {
                fail("ROOT_MUST_BE_EMITTER", "/program/rootNodeId", rootDefinition.Id,
                    "The program root must be its emitter.");
            }

            for (int index = 0; index < emitters.Count; index += 1)
            {
                KnownNode emitter = emitters[index];
                if (!string.Equals(emitter.Node.NodeId, program.RootNodeId, StringComparison.Ordinal))
                {
                    fail("EMITTER_NOT_ROOT", NodePath(emitter.Index), emitter.Definition.Id,
                        "An emitter may only appear at the program root.");
                }
            }

            List<KnownNode> triggers = FindByKind(knownNodes, BusterModuleKind.Trigger);
            List<KnownNode> splitters = FindByKind(knownNodes, BusterModuleKind.Splitter);
            if (triggers.Count > 1)
            {
                KnownNode second = triggers[1];
                fail("TOO_MANY_TRIGGERS", NodePath(second.Index), second.Definition.Id,
                    "A v0.2 program can contain at most one trigger.");
            }

            if (splitters.Count > 1)
            {
                KnownNode second = splitters[1];
                fail("TOO_MANY_SPLITTERS", NodePath(second.Index), second.Definition.Id,
                    "A v0.2 program can contain at most one splitter.");
            }

            ValidateOutgoingRules(knownNodes, outgoing, fail);
            var scopes = new Dictionary<string, string>(StringComparer.Ordinal);
            WalkScopes(program.RootNodeId, "root", nodeById, moduleByNodeId, outgoing, scopes, new HashSet<string>(StringComparer.Ordinal));
            ValidateScopeRules(knownNodes, triggers, splitters, scopes, fail);
            ValidateGrammar(program, nodeById, nodeIndexById, moduleByNodeId, outgoing, fail);

            BusterModuleDefinition emitterDefinition = rootDefinition?.Kind == BusterModuleKind.Emitter
                ? rootDefinition
                : emitters.Count > 0 ? emitters[0].Definition : null;
            if (emitterDefinition != null)
            {
                for (int index = 0; index < knownNodes.Count; index += 1)
                {
                    KnownNode entry = knownNodes[index];
                    if (!IsCompatible(entry.Definition, emitterDefinition))
                    {
                        fail("INCOMPATIBLE_MODULE", NodePath(entry.Index, "/moduleId"), entry.Definition.Id,
                            $"{entry.Definition.Label} is not compatible with {emitterDefinition.Label}.");
                    }
                }
            }

            ValidateOwnership(knownNodes, context, validatePhysical, fail);
            bool hasUnknown = knownNodes.Count != CountNonNullNodes(program.Nodes);
            if (!hasUnknown && tuningValid)
            {
                double energyCost = 0d;
                for (int index = 0; index < knownNodes.Count; index += 1)
                {
                    energyCost += knownNodes[index].Definition.EnergyCost;
                }

                double maximumEnergy = BusterRuleset.GetMaximumEnergy(build.Tuning.Energy);
                if (energyCost > maximumEnergy)
                {
                    fail("INSUFFICIENT_ENERGY", "/program/nodes", null,
                        $"Program energy cost {energyCost} exceeds chassis capacity {maximumEnergy}.");
                }
            }

            if (emitterDefinition != null && tuningValid)
            {
                for (int index = 0; index < triggers.Count; index += 1)
                {
                    KnownNode trigger = triggers[index];
                    if (!string.Equals(trigger.Definition.TriggerEvent, "delay", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    double rootRange = emitterDefinition.BaseRange * BusterRuleset.GetTuningMultiplier(build.Tuning.Range);
                    double nominalLifetime = rootRange / emitterDefinition.ProjectileSpeed;
                    double remainingWindow = nominalLifetime - trigger.Definition.Delay;
                    if (trigger.Definition.Delay > nominalLifetime + BusterRuleset.TriggerTimeEpsilon)
                    {
                        fail("TRIGGER_UNREACHABLE", NodePath(trigger.Index), trigger.Definition.Id,
                            $"{trigger.Definition.Label} fires after the carrier's nominal lifetime.");
                    }
                    else if (remainingWindow < BusterRuleset.TriggerWindowWarningSeconds + BusterRuleset.TriggerTimeEpsilon)
                    {
                        warn("TRIGGER_WINDOW_NARROW", NodePath(trigger.Index), trigger.Definition.Id,
                            $"{trigger.Definition.Label} has only {Math.Max(0d, remainingWindow):0.000}s before nominal carrier expiry.");
                    }
                }
            }

            return new BusterValidationResult(
                errors,
                warnings,
                semanticCapacityUsed,
                BusterBuildSource.Normalize(build));
        }

        private static bool ValidateTuning(
            BusterTuning tuning,
            Action<string, string, string, string> fail)
        {
            if (tuning == null)
            {
                fail("INVALID_TUNING", "/tuning", null, "tuning must contain four chassis ratings.");
                return false;
            }

            bool valid = true;
            valid &= ValidateRating("power", tuning.Power, fail);
            valid &= ValidateRating("energy", tuning.Energy, fail);
            valid &= ValidateRating("range", tuning.Range, fail);
            valid &= ValidateRating("rapid", tuning.Rapid, fail);
            if (valid && tuning.Total != BusterRuleset.TuningTotal)
            {
                fail("INVALID_TUNING_TOTAL", "/tuning", null,
                    $"Chassis ratings must total exactly {BusterRuleset.TuningTotal}; received {tuning.Total}.");
            }

            return valid;
        }

        private static bool ValidateRating(
            string key,
            int value,
            Action<string, string, string, string> fail)
        {
            bool valid = value >= BusterRuleset.TuningMinimum && value <= BusterRuleset.TuningMaximum;
            if (!valid)
            {
                fail("INVALID_TUNING_RATING", "/tuning/" + key, null,
                    $"{key} must be an integer from {BusterRuleset.TuningMinimum} through {BusterRuleset.TuningMaximum}.");
            }

            return valid;
        }

        private static void ValidateOutgoingRules(
            IList<KnownNode> knownNodes,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            Action<string, string, string, string> fail)
        {
            for (int index = 0; index < knownNodes.Count; index += 1)
            {
                KnownNode entry = knownNodes[index];
                int nextCount = GetOutgoing(outgoing, entry.Node.NodeId, BusterEdgePorts.Next).Count;
                int childCount = GetOutgoing(outgoing, entry.Node.NodeId, BusterEdgePorts.Child).Count;
                if (entry.Definition.Kind == BusterModuleKind.Payload && nextCount + childCount > 0)
                {
                    fail("PAYLOAD_NOT_TERMINAL", NodePath(entry.Index), entry.Definition.Id,
                        "Payload modules must be terminal.");
                }

                if (entry.Definition.Kind == BusterModuleKind.Trigger)
                {
                    if (childCount != 1)
                    {
                        fail("TRIGGER_CHILD_REQUIRED", NodePath(entry.Index), entry.Definition.Id,
                            "A trigger must have exactly one child edge.");
                    }

                    if (nextCount > 0)
                    {
                        fail("TRIGGER_NEXT_NOT_ALLOWED", NodePath(entry.Index), entry.Definition.Id,
                            "A trigger cannot have a next edge; carrier behavior is intrinsic.");
                    }
                }
                else if (childCount > 0)
                {
                    fail("CHILD_EDGE_REQUIRES_TRIGGER", NodePath(entry.Index), entry.Definition.Id,
                        "Only a trigger may own a child edge.");
                }
            }
        }

        private static void ValidateScopeRules(
            IList<KnownNode> knownNodes,
            IList<KnownNode> triggers,
            IList<KnownNode> splitters,
            IDictionary<string, string> scopes,
            Action<string, string, string, string> fail)
        {
            var modifiersByScope = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < knownNodes.Count; index += 1)
            {
                KnownNode entry = knownNodes[index];
                string scope = GetScope(scopes, entry.Node.NodeId);
                if (entry.Definition.Kind == BusterModuleKind.Modifier && !modifiersByScope.Add(scope))
                {
                    fail("TOO_MANY_MODIFIERS_IN_SCOPE", NodePath(entry.Index), entry.Definition.Id,
                        "A scope can contain at most one modifier.");
                }
            }

            if (triggers.Count > 0)
            {
                for (int index = 0; index < splitters.Count; index += 1)
                {
                    KnownNode splitter = splitters[index];
                    if (string.Equals(GetScope(scopes, splitter.Node.NodeId), "root", StringComparison.Ordinal))
                    {
                        fail("INVALID_MODULE_ORDER", NodePath(splitter.Index), splitter.Definition.Id,
                            "A triggered program may split only the terminal child batch.");
                    }
                }
            }

            for (int index = 0; index < splitters.Count; index += 1)
            {
                KnownNode splitter = splitters[index];
                if (splitter.Definition.ChildOnly
                    && string.Equals(GetScope(scopes, splitter.Node.NodeId), "root", StringComparison.Ordinal))
                {
                    fail("CHILD_ONLY_MODULE", NodePath(splitter.Index), splitter.Definition.Id,
                        $"{splitter.Definition.Label} may only appear in a trigger child branch.");
                }
            }
        }

        private static void ValidateGrammar(
            BusterProgramSource program,
            IDictionary<string, BusterNodeSource> nodeById,
            IDictionary<string, int> nodeIndexById,
            IDictionary<string, BusterModuleDefinition> moduleByNodeId,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            Action<string, string, string, string> fail)
        {
            BusterNodeSource root = GetNode(nodeById, program.RootNodeId);
            List<BusterNodeSource> rootSequence = ReadChain(root, true, nodeById, moduleByNodeId, outgoing);
            BusterNodeSource trigger = null;
            for (int index = 0; index < rootSequence.Count; index += 1)
            {
                BusterNodeSource node = rootSequence[index];
                if (GetDefinition(moduleByNodeId, node.NodeId)?.Kind == BusterModuleKind.Trigger)
                {
                    trigger = node;
                    break;
                }
            }

            if (trigger == null)
            {
                EnforceGrammar(rootSequence,
                    new[] { BusterModuleKind.Emitter, BusterModuleKind.Modifier, BusterModuleKind.Splitter, BusterModuleKind.Payload },
                    "root", nodeIndexById, moduleByNodeId, fail);
                return;
            }

            IndexedEdge childEdge = First(GetOutgoing(outgoing, trigger.NodeId, BusterEdgePorts.Child));
            BusterNodeSource childStart = childEdge == null ? null : GetNode(nodeById, childEdge.Edge.To);
            List<BusterNodeSource> childSequence = ReadChain(childStart, false, nodeById, moduleByNodeId, outgoing);
            EnforceGrammar(rootSequence,
                new[] { BusterModuleKind.Emitter, BusterModuleKind.Modifier, BusterModuleKind.Trigger },
                "root", nodeIndexById, moduleByNodeId, fail);
            EnforceGrammar(childSequence,
                new[] { BusterModuleKind.Modifier, BusterModuleKind.Splitter, BusterModuleKind.Payload },
                "child", nodeIndexById, moduleByNodeId, fail);
        }

        private static void EnforceGrammar(
            IList<BusterNodeSource> sequence,
            BusterModuleKind[] allowedKinds,
            string scope,
            IDictionary<string, int> nodeIndexById,
            IDictionary<string, BusterModuleDefinition> moduleByNodeId,
            Action<string, string, string, string> fail)
        {
            int grammarIndex = 0;
            for (int index = 0; index < sequence.Count; index += 1)
            {
                BusterNodeSource node = sequence[index];
                BusterModuleDefinition definition = GetDefinition(moduleByNodeId, node.NodeId);
                if (definition == null)
                {
                    continue;
                }

                int found = -1;
                for (int candidate = grammarIndex; candidate < allowedKinds.Length; candidate += 1)
                {
                    if (allowedKinds[candidate] == definition.Kind)
                    {
                        found = candidate;
                        break;
                    }
                }

                if (found < 0)
                {
                    int sourceIndex = nodeIndexById.TryGetValue(node.NodeId, out int value) ? value : 0;
                    fail("INVALID_MODULE_ORDER", NodePath(sourceIndex), definition.Id,
                        $"{definition.Label} cannot appear at this position in the {scope} program strip.");
                }
                else
                {
                    grammarIndex = found + 1;
                }
            }
        }

        private static void ValidateOwnership(
            IList<KnownNode> knownNodes,
            BusterValidationContext context,
            bool validatePhysical,
            Action<string, string, string, string> fail)
        {
            if (!validatePhysical || context == null)
            {
                return;
            }

            var owned = context.OwnedModuleInstanceIds == null
                ? null
                : new HashSet<string>(context.OwnedModuleInstanceIds, StringComparer.Ordinal);
            var claimed = context.ClaimedModuleInstanceIds == null
                ? null
                : new HashSet<string>(context.ClaimedModuleInstanceIds, StringComparer.Ordinal);
            for (int index = 0; index < knownNodes.Count; index += 1)
            {
                KnownNode entry = knownNodes[index];
                string instanceId = entry.Node.ModuleInstanceId;
                if (!entry.Definition.Physical || !IsNonEmpty(instanceId))
                {
                    continue;
                }

                if (owned != null && !owned.Contains(instanceId))
                {
                    fail("INSTANCE_NOT_OWNED", NodePath(entry.Index, "/moduleInstanceId"), entry.Definition.Id,
                        $"Module instance \"{instanceId}\" is not owned.");
                }

                if (claimed != null && claimed.Contains(instanceId))
                {
                    fail("INSTANCE_ALREADY_CLAIMED", NodePath(entry.Index, "/moduleInstanceId"), entry.Definition.Id,
                        $"Module instance \"{instanceId}\" is already claimed by another build.");
                }
            }
        }

        private static void WalkScopes(
            string nodeId,
            string scope,
            IDictionary<string, BusterNodeSource> nodeById,
            IDictionary<string, BusterModuleDefinition> moduleByNodeId,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            IDictionary<string, string> scopes,
            ISet<string> ancestry)
        {
            if (!IsNonEmpty(nodeId) || ancestry.Contains(nodeId) || !nodeById.ContainsKey(nodeId))
            {
                return;
            }

            if (!scopes.ContainsKey(nodeId))
            {
                scopes.Add(nodeId, scope);
            }

            var nextAncestry = new HashSet<string>(ancestry, StringComparer.Ordinal) { nodeId };
            BusterModuleDefinition definition = GetDefinition(moduleByNodeId, nodeId);
            IList<IndexedEdge> nextEdges = GetOutgoing(outgoing, nodeId, BusterEdgePorts.Next);
            for (int index = 0; index < nextEdges.Count; index += 1)
            {
                WalkScopes(nextEdges[index].Edge.To, scope, nodeById, moduleByNodeId, outgoing, scopes, nextAncestry);
            }

            IList<IndexedEdge> childEdges = GetOutgoing(outgoing, nodeId, BusterEdgePorts.Child);
            for (int index = 0; index < childEdges.Count; index += 1)
            {
                string childScope = definition?.Kind == BusterModuleKind.Trigger ? "child:" + nodeId : scope;
                WalkScopes(childEdges[index].Edge.To, childScope, nodeById, moduleByNodeId, outgoing, scopes, nextAncestry);
            }
        }

        private static bool HasCycle(
            IEnumerable<string> nodeIds,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing)
        {
            var state = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (string nodeId in nodeIds)
            {
                if (VisitForCycle(nodeId, outgoing, state))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool VisitForCycle(
            string nodeId,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            IDictionary<string, int> state)
        {
            if (state.TryGetValue(nodeId, out int current))
            {
                return current == 1;
            }

            state[nodeId] = 1;
            foreach (string port in new[] { BusterEdgePorts.Next, BusterEdgePorts.Child })
            {
                IList<IndexedEdge> edges = GetOutgoing(outgoing, nodeId, port);
                for (int index = 0; index < edges.Count; index += 1)
                {
                    if (VisitForCycle(edges[index].Edge.To, outgoing, state))
                    {
                        return true;
                    }
                }
            }

            state[nodeId] = 2;
            return false;
        }

        private static HashSet<string> FindReachable(
            string rootNodeId,
            IDictionary<string, BusterNodeSource> nodeById,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            VisitReachable(rootNodeId, nodeById, outgoing, result);
            return result;
        }

        private static void VisitReachable(
            string nodeId,
            IDictionary<string, BusterNodeSource> nodeById,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            ISet<string> result)
        {
            if (!IsNonEmpty(nodeId) || !nodeById.ContainsKey(nodeId) || !result.Add(nodeId))
            {
                return;
            }

            foreach (string port in new[] { BusterEdgePorts.Next, BusterEdgePorts.Child })
            {
                IList<IndexedEdge> edges = GetOutgoing(outgoing, nodeId, port);
                for (int index = 0; index < edges.Count; index += 1)
                {
                    VisitReachable(edges[index].Edge.To, nodeById, outgoing, result);
                }
            }
        }

        private static List<BusterNodeSource> ReadChain(
            BusterNodeSource start,
            bool stopAtTrigger,
            IDictionary<string, BusterNodeSource> nodeById,
            IDictionary<string, BusterModuleDefinition> moduleByNodeId,
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing)
        {
            var result = new List<BusterNodeSource>();
            var visited = new HashSet<string>(StringComparer.Ordinal);
            BusterNodeSource current = start;
            while (current != null && IsNonEmpty(current.NodeId) && visited.Add(current.NodeId))
            {
                result.Add(current);
                BusterModuleDefinition definition = GetDefinition(moduleByNodeId, current.NodeId);
                if (stopAtTrigger && definition?.Kind == BusterModuleKind.Trigger)
                {
                    break;
                }

                IndexedEdge next = First(GetOutgoing(outgoing, current.NodeId, BusterEdgePorts.Next));
                current = next == null ? null : GetNode(nodeById, next.Edge.To);
            }

            return result;
        }

        private static bool IsCompatible(BusterModuleDefinition definition, BusterModuleDefinition emitter)
        {
            if (definition == null || emitter == null || definition.Kind == BusterModuleKind.Emitter)
            {
                return true;
            }

            if (definition.CompatibleEmitterTags.Count == 0)
            {
                return true;
            }

            var tags = new HashSet<string>(emitter.EmitterTags, StringComparer.Ordinal);
            for (int index = 0; index < definition.CompatibleEmitterTags.Count; index += 1)
            {
                if (tags.Contains(definition.CompatibleEmitterTags[index]))
                {
                    return true;
                }
            }

            return false;
        }

        private static List<KnownNode> FindByKind(IList<KnownNode> entries, BusterModuleKind kind)
        {
            var result = new List<KnownNode>();
            for (int index = 0; index < entries.Count; index += 1)
            {
                if (entries[index].Definition.Kind == kind)
                {
                    result.Add(entries[index]);
                }
            }

            return result;
        }

        private static IList<IndexedEdge> GetOutgoing(
            IDictionary<string, Dictionary<string, List<IndexedEdge>>> outgoing,
            string nodeId,
            string port)
        {
            if (!IsNonEmpty(nodeId)
                || !outgoing.TryGetValue(nodeId, out Dictionary<string, List<IndexedEdge>> ports)
                || !ports.TryGetValue(port, out List<IndexedEdge> edges))
            {
                return Array.Empty<IndexedEdge>();
            }

            return edges;
        }

        private static IndexedEdge First(IList<IndexedEdge> edges)
        {
            return edges.Count > 0 ? edges[0] : null;
        }

        private static BusterModuleDefinition GetDefinition(
            IDictionary<string, BusterModuleDefinition> definitions,
            string nodeId)
        {
            if (!IsNonEmpty(nodeId))
            {
                return null;
            }

            definitions.TryGetValue(nodeId, out BusterModuleDefinition definition);
            return definition;
        }

        private static BusterNodeSource GetNode(IDictionary<string, BusterNodeSource> nodes, string nodeId)
        {
            if (!IsNonEmpty(nodeId))
            {
                return null;
            }

            nodes.TryGetValue(nodeId, out BusterNodeSource node);
            return node;
        }

        private static string GetScope(IDictionary<string, string> scopes, string nodeId)
        {
            return IsNonEmpty(nodeId) && scopes.TryGetValue(nodeId, out string scope)
                ? scope
                : "disconnected:" + (nodeId ?? string.Empty);
        }

        private static int CountNonNullNodes(IReadOnlyList<BusterNodeSource> nodes)
        {
            int result = 0;
            for (int index = 0; index < nodes.Count; index += 1)
            {
                if (nodes[index] != null)
                {
                    result += 1;
                }
            }

            return result;
        }

        private static bool IsNonEmpty(string value)
        {
            return !string.IsNullOrWhiteSpace(value);
        }

        private static string NodePath(int index, string suffix = "")
        {
            return "/program/nodes/" + index + suffix;
        }

        private static string EdgePath(int index, string suffix = "")
        {
            return "/program/edges/" + index + suffix;
        }

        private static void AddIssue(
            IList<BusterValidationIssue> destination,
            ISet<string> seen,
            string code,
            string path,
            string moduleId,
            string message)
        {
            string key = code + "\0" + path + "\0" + (moduleId ?? string.Empty);
            if (seen.Add(key))
            {
                destination.Add(new BusterValidationIssue(code, path, moduleId, message));
            }
        }
    }
}
