using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public static class BusterCompiler
    {
        private sealed class SequenceData
        {
            public SequenceData(
                IList<BusterNodeSource> root,
                IList<BusterNodeSource> child,
                BusterNodeSource triggerNode)
            {
                Root = root;
                Child = child;
                TriggerNode = triggerNode;
                Ordered = new List<BusterNodeSource>(root);
                for (int index = 0; index < child.Count; index += 1)
                {
                    Ordered.Add(child[index]);
                }
            }

            public IList<BusterNodeSource> Root { get; }
            public IList<BusterNodeSource> Child { get; }
            public IList<BusterNodeSource> Ordered { get; }
            public BusterNodeSource TriggerNode { get; }
        }

        public static CompiledBusterPlan Compile(BusterBuildSource build, int combatDepthLevel = 1)
        {
            BusterValidationResult validation = BusterValidator.ValidateProgram(build);
            if (!validation.IsValid)
            {
                throw new BusterCompileException(validation.Errors);
            }

            return CompileValidated(
                validation.NormalizedBuild,
                validation,
                validation.NormalizedBuild.Tuning,
                combatDepthLevel,
                false);
        }

        public static bool TryCompile(
            BusterBuildSource build,
            out CompiledBusterPlan plan,
            out BusterValidationResult validation,
            int combatDepthLevel = 1)
        {
            validation = BusterValidator.ValidateProgram(build);
            if (!validation.IsValid)
            {
                plan = null;
                return false;
            }

            plan = CompileValidated(
                validation.NormalizedBuild,
                validation,
                validation.NormalizedBuild.Tuning,
                combatDepthLevel,
                false);
            return true;
        }

        public static CompiledBusterPlan CompileMega(
            BusterTuning resolvedTuning = null,
            int revision = 0,
            int combatDepthLevel = 1)
        {
            BusterTuning tuning = resolvedTuning ?? MegaBusterProfile.NeutralTuning;
            var errors = new List<BusterValidationIssue>();
            ValidateMegaRating("power", tuning.Power, errors);
            ValidateMegaRating("energy", tuning.Energy, errors);
            ValidateMegaRating("range", tuning.Range, errors);
            ValidateMegaRating("rapid", tuning.Rapid, errors);
            if (errors.Count > 0)
            {
                throw new BusterCompileException(Array.AsReadOnly(errors.ToArray()));
            }

            var source = new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                MegaBusterProfile.BuildId,
                MegaBusterProfile.ChassisId,
                MegaBusterProfile.NeutralTuning,
                new BusterProgramSource(
                    "mega-pulse",
                    new[]
                    {
                        new BusterNodeSource(
                            "mega-pulse",
                            MegaBusterProfile.EmitterModuleId,
                            MegaBusterProfile.ModuleInstanceId)
                    },
                    Array.Empty<BusterEdgeSource>()),
                revision);
            BusterValidationResult validation = BusterValidator.ValidateProgram(source);
            if (!validation.IsValid)
            {
                throw new BusterCompileException(validation.Errors);
            }

            return CompileValidated(
                validation.NormalizedBuild,
                validation,
                tuning,
                combatDepthLevel,
                true);
        }

        private static CompiledBusterPlan CompileValidated(
            BusterBuildSource source,
            BusterValidationResult validation,
            BusterTuning resolvedTuning,
            int authoredCombatDepthLevel,
            bool isMegaBuster)
        {
            SequenceData sequences = ReadSequences(source);
            BusterModuleDefinition emitter = BusterModuleCatalog.Get(sequences.Root[0].ModuleId);
            BusterModuleDefinition trigger = sequences.TriggerNode == null
                ? null
                : BusterModuleCatalog.Get(sequences.TriggerNode.ModuleId);
            BusterModuleDefinition rootGuidance = FindKind(sequences.Root, BusterModuleKind.Modifier);
            BusterModuleDefinition childGuidance = FindKind(sequences.Child, BusterModuleKind.Modifier);
            BusterModuleDefinition splitter = FindKind(sequences.Ordered, BusterModuleKind.Splitter);
            BusterModuleDefinition explicitPayload = FindKind(sequences.Ordered, BusterModuleKind.Payload);
            BusterTriggerConfiguration triggerConfiguration = trigger == null
                ? null
                : new BusterTriggerConfiguration(trigger);
            BusterSplitterConfiguration splitterConfiguration = splitter == null
                ? null
                : new BusterSplitterConfiguration(splitter);
            BusterPayloadConfiguration payloadConfiguration = explicitPayload == null
                ? new BusterPayloadConfiguration(null, emitter.NativePayload, 0d, false, true)
                : new BusterPayloadConfiguration(
                    explicitPayload.Id,
                    explicitPayload.Payload,
                    explicitPayload.Radius,
                    explicitPayload.ReplacesDirect,
                    false);

            double powerMultiplier = BusterRuleset.GetTuningMultiplier(resolvedTuning.Power);
            double rangeMultiplier = BusterRuleset.GetTuningMultiplier(resolvedTuning.Range);
            double rapidMultiplier = BusterRuleset.GetTuningMultiplier(resolvedTuning.Rapid);
            int combatDepthLevel = BusterRuleset.GetCombatDepthLevel(authoredCombatDepthLevel);
            double combatDepthScalar = BusterRuleset.GetCombatDepthScalar(combatDepthLevel);
            double tunedPower = emitter.BasePower * powerMultiplier;
            double depthScaledPower = tunedPower * combatDepthScalar;
            double rootRange = emitter.BaseRange * rangeMultiplier;
            double childRange = rootRange * BusterRuleset.ChildRangeMultiplier;
            double baseRapid = emitter.BaseRapid * rapidMultiplier;
            double baseCycleTime = 1d / baseRapid;
            double maximumEnergy = BusterRuleset.GetMaximumEnergy(resolvedTuning.Energy);
            double energyCost = SumEnergy(sequences.Ordered);
            double cycleDelay = SumCycleDelay(sequences.Ordered);
            double cycleTime = baseCycleTime + cycleDelay;
            double finalRapid = 1d / cycleTime;
            int shotsPerCharge = energyCost <= 0d ? 0 : (int)Math.Floor(maximumEnergy / energyCost);

            double rootPacketPower = depthScaledPower;
            if (rootGuidance != null)
            {
                rootPacketPower *= rootGuidance.PowerMultiplier;
            }

            double rawCarrierPower = 0d;
            double rawTerminalPower = rootPacketPower;
            if (trigger != null)
            {
                rawCarrierPower = rootPacketPower * trigger.CarrierAllocation;
                rawTerminalPower = rootPacketPower * trigger.ChildTransfer;
            }

            if (childGuidance != null)
            {
                rawTerminalPower *= childGuidance.PowerMultiplier;
            }

            if (splitter != null)
            {
                rawTerminalPower *= splitter.TotalPowerMultiplier;
            }

            double rawEffectivePower = rawCarrierPower + rawTerminalPower;
            double rawEffectiveMultiplier = depthScaledPower > 0d
                ? rawEffectivePower / depthScaledPower
                : 0d;
            double effectiveMultiplier = BusterRuleset.ApplyPowerSoftCap(rawEffectiveMultiplier);
            double capMultiplier = rawEffectiveMultiplier > 0d
                ? effectiveMultiplier / rawEffectiveMultiplier
                : 1d;
            double carrierPower = rawCarrierPower * capMultiplier;
            double terminalTotalPower = rawTerminalPower * capMultiplier;
            double effectivePower = carrierPower + terminalTotalPower;
            double compression = rawEffectivePower - effectivePower;
            var powerSoftCap = new BusterPowerSoftCap(
                rawEffectiveMultiplier > BusterRuleset.PowerSoftCapKnee,
                rawEffectiveMultiplier,
                effectiveMultiplier,
                compression);

            int projectileCount = splitter?.ProjectileCount ?? 1;
            double perChildPower = terminalTotalPower / projectileCount;
            double stagger = GetImpactStagger(payloadConfiguration, emitter, perChildPower);
            double carrierStagger = GetNativeCarrierStagger(emitter, carrierPower);
            int peakProjectileReservation = Math.Max(1, projectileCount);

            double nominalRootLifetime = rootRange / emitter.ProjectileSpeed;
            double nominalChildLifetime = childRange / emitter.ProjectileSpeed;
            double? triggerNominalTime = null;
            double? triggerNominalProgress = null;
            if (trigger != null)
            {
                if (string.Equals(trigger.TriggerEvent, "delay", StringComparison.Ordinal))
                {
                    triggerNominalTime = trigger.Delay;
                    triggerNominalProgress = trigger.Delay / nominalRootLifetime;
                }
                else if (string.Equals(trigger.TriggerEvent, "apex", StringComparison.Ordinal))
                {
                    triggerNominalTime = nominalRootLifetime * 0.5d;
                    triggerNominalProgress = 0.5d;
                }
                else
                {
                    triggerNominalTime = nominalRootLifetime;
                    triggerNominalProgress = 1d;
                }
            }

            double carrierSeconds = trigger == null
                ? 0d
                : Math.Min(nominalRootLifetime, Math.Max(0d, triggerNominalTime ?? 0d));
            double projectileSeconds = trigger == null
                ? projectileCount * nominalRootLifetime
                : carrierSeconds + (projectileCount * nominalChildLifetime);
            var occupancy = new BusterOccupancy(
                peakProjectileReservation,
                nominalRootLifetime,
                nominalChildLifetime,
                carrierSeconds,
                projectileSeconds,
                projectileSeconds / cycleTime);
            var trajectory = new BusterTrajectory(
                emitter.Trajectory,
                emitter.ProjectileSpeed,
                rootRange,
                childRange,
                nominalRootLifetime,
                nominalChildLifetime,
                trigger?.TriggerEvent,
                triggerNominalTime,
                triggerNominalProgress);
            var stats = new BusterStats(
                emitter.BasePower,
                tunedPower,
                depthScaledPower,
                combatDepthLevel,
                combatDepthScalar,
                effectivePower,
                rawEffectivePower,
                perChildPower,
                carrierPower,
                maximumEnergy,
                energyCost,
                cycleTime,
                finalRapid,
                rootRange,
                childRange,
                emitter.ProjectileSpeed,
                projectileCount,
                shotsPerCharge,
                stagger,
                carrierStagger,
                peakProjectileReservation,
                validation.SemanticCapacityUsed,
                powerSoftCap,
                occupancy);

            BusterPacket rootPacket = trigger == null
                ? new BusterPacket(
                    projectileCount,
                    perChildPower,
                    terminalTotalPower,
                    perChildPower,
                    rootRange,
                    emitter.ProjectileSpeed,
                    stagger)
                : new BusterPacket(
                    1,
                    rootPacketPower,
                    rootPacketPower,
                    carrierPower,
                    rootRange,
                    emitter.ProjectileSpeed,
                    carrierStagger);
            BusterPacket carrierPacket = trigger == null
                ? null
                : new BusterPacket(
                    1,
                    rootPacketPower,
                    rootPacketPower,
                    carrierPower,
                    rootRange,
                    emitter.ProjectileSpeed,
                    carrierStagger);
            BusterPacket childPacket = trigger == null
                ? null
                : new BusterPacket(
                    projectileCount,
                    perChildPower,
                    terminalTotalPower,
                    perChildPower,
                    childRange,
                    emitter.ProjectileSpeed,
                    stagger);
            List<BusterAction> actions = CreateActions(
                emitter,
                rootGuidance,
                childGuidance,
                triggerConfiguration,
                splitterConfiguration,
                payloadConfiguration,
                projectileCount,
                rootPacketPower,
                carrierPower,
                terminalTotalPower,
                perChildPower,
                rootRange,
                childRange,
                stagger,
                carrierStagger);
            var order = new BusterProgramOrder(GetNodeIds(sequences.Root), GetNodeIds(sequences.Child));
            string description = isMegaBuster
                ? $"Fixed Mega Buster Pulse. {shotsPerCharge} shots per battery; weapon-local PWR / ENG / RNG / RPD."
                : CreateDescription(
                    emitter,
                    rootGuidance,
                    trigger,
                    childGuidance,
                    splitter,
                    payloadConfiguration,
                    stats,
                    compression);

            return new CompiledBusterPlan(
                source,
                isMegaBuster,
                new BusterEmitterConfiguration(emitter),
                rootGuidance != null,
                triggerConfiguration,
                childGuidance != null,
                splitterConfiguration,
                payloadConfiguration,
                rootPacket,
                carrierPacket,
                childPacket,
                trajectory,
                stats,
                order,
                actions,
                validation.Warnings,
                description);
        }

        private static List<BusterAction> CreateActions(
            BusterModuleDefinition emitter,
            BusterModuleDefinition rootGuidance,
            BusterModuleDefinition childGuidance,
            BusterTriggerConfiguration trigger,
            BusterSplitterConfiguration splitter,
            BusterPayloadConfiguration payload,
            int count,
            double rootPacketPower,
            double carrierPower,
            double terminalTotalPower,
            double perChildPower,
            double rootRange,
            double childRange,
            double stagger,
            double carrierStagger)
        {
            var actions = new List<BusterAction>();
            if (trigger == null)
            {
                actions.Add(new BusterAction(
                    "emit-root", "emit", "root", emitter.Id, count,
                    perChildPower, terminalTotalPower, perChildPower,
                    rootRange, emitter.ProjectileSpeed, emitter.Trajectory,
                    rootGuidance != null, null, splitter, payload, stagger));
                return actions;
            }

            var nativePayload = new BusterPayloadConfiguration(null, emitter.NativePayload, 0d, false, true);
            actions.Add(new BusterAction(
                "emit-carrier", "emit", "root", emitter.Id, 1,
                rootPacketPower, rootPacketPower, carrierPower,
                rootRange, emitter.ProjectileSpeed, emitter.Trajectory,
                rootGuidance != null, null, null, nativePayload, carrierStagger));
            actions.Add(new BusterAction(
                "trigger-child", "trigger", "root", trigger.ModuleId, 0,
                carrierPower, terminalTotalPower, carrierPower,
                0d, 0d, null, false, trigger, null, null, 0d, "emit-child"));
            actions.Add(new BusterAction(
                "emit-child", "emit", "child", emitter.Id, count,
                perChildPower, terminalTotalPower, perChildPower,
                childRange, emitter.ProjectileSpeed, emitter.Trajectory,
                childGuidance != null, null, splitter, payload, stagger));
            return actions;
        }

        private static SequenceData ReadSequences(BusterBuildSource build)
        {
            var nodeById = new Dictionary<string, BusterNodeSource>(StringComparer.Ordinal);
            var edges = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            for (int index = 0; index < build.Program.Nodes.Count; index += 1)
            {
                BusterNodeSource node = build.Program.Nodes[index];
                nodeById[node.NodeId] = node;
            }

            for (int index = 0; index < build.Program.Edges.Count; index += 1)
            {
                BusterEdgeSource edge = build.Program.Edges[index];
                if (!edges.TryGetValue(edge.From, out Dictionary<string, string> ports))
                {
                    ports = new Dictionary<string, string>(StringComparer.Ordinal);
                    edges.Add(edge.From, ports);
                }

                ports[edge.Port] = edge.To;
            }

            var root = new List<BusterNodeSource>();
            var child = new List<BusterNodeSource>();
            BusterNodeSource current = nodeById[build.Program.RootNodeId];
            BusterNodeSource triggerNode = null;
            while (current != null)
            {
                root.Add(current);
                if (BusterModuleCatalog.Get(current.ModuleId).Kind == BusterModuleKind.Trigger)
                {
                    triggerNode = current;
                    break;
                }

                current = GetNext(current.NodeId, BusterEdgePorts.Next, nodeById, edges);
            }

            if (triggerNode != null)
            {
                current = GetNext(triggerNode.NodeId, BusterEdgePorts.Child, nodeById, edges);
                while (current != null)
                {
                    child.Add(current);
                    current = GetNext(current.NodeId, BusterEdgePorts.Next, nodeById, edges);
                }
            }

            return new SequenceData(root, child, triggerNode);
        }

        private static BusterNodeSource GetNext(
            string nodeId,
            string port,
            IDictionary<string, BusterNodeSource> nodes,
            IDictionary<string, Dictionary<string, string>> edges)
        {
            if (!edges.TryGetValue(nodeId, out Dictionary<string, string> ports)
                || !ports.TryGetValue(port, out string target)
                || !nodes.TryGetValue(target, out BusterNodeSource node))
            {
                return null;
            }

            return node;
        }

        private static BusterModuleDefinition FindKind(IList<BusterNodeSource> nodes, BusterModuleKind kind)
        {
            for (int index = 0; index < nodes.Count; index += 1)
            {
                BusterModuleDefinition definition = BusterModuleCatalog.Get(nodes[index].ModuleId);
                if (definition.Kind == kind)
                {
                    return definition;
                }
            }

            return null;
        }

        private static double SumEnergy(IList<BusterNodeSource> nodes)
        {
            double result = 0d;
            for (int index = 0; index < nodes.Count; index += 1)
            {
                result += BusterModuleCatalog.Get(nodes[index].ModuleId).EnergyCost;
            }

            return result;
        }

        private static double SumCycleDelay(IList<BusterNodeSource> nodes)
        {
            double result = 0d;
            for (int index = 0; index < nodes.Count; index += 1)
            {
                result += BusterModuleCatalog.Get(nodes[index].ModuleId).CycleDelay;
            }

            return result;
        }

        private static double GetImpactStagger(
            BusterPayloadConfiguration payload,
            BusterModuleDefinition emitter,
            double power)
        {
            if (string.Equals(payload.Type, "explosion", StringComparison.Ordinal))
            {
                return Math.Min(0.3d, power * 0.015d);
            }

            if (string.Equals(payload.Type, "pulse", StringComparison.Ordinal))
            {
                return Math.Min(0.18d, power * 0.01d);
            }

            return string.Equals(emitter.NativePayload, "ballistic", StringComparison.Ordinal)
                ? Math.Min(0.25d, power * 0.015d)
                : Math.Min(0.18d, power * 0.01d);
        }

        private static double GetNativeCarrierStagger(BusterModuleDefinition emitter, double power)
        {
            return string.Equals(emitter.NativePayload, "ballistic", StringComparison.Ordinal)
                ? Math.Min(0.25d, power * 0.015d)
                : Math.Min(0.18d, power * 0.01d);
        }

        private static IEnumerable<string> GetNodeIds(IList<BusterNodeSource> nodes)
        {
            var result = new string[nodes.Count];
            for (int index = 0; index < nodes.Count; index += 1)
            {
                result[index] = nodes[index].NodeId;
            }

            return result;
        }

        private static string CreateDescription(
            BusterModuleDefinition emitter,
            BusterModuleDefinition rootGuidance,
            BusterModuleDefinition trigger,
            BusterModuleDefinition childGuidance,
            BusterModuleDefinition splitter,
            BusterPayloadConfiguration payload,
            BusterStats stats,
            double compression)
        {
            var stages = new List<string> { emitter.Label };
            if (rootGuidance != null)
            {
                stages.Add(rootGuidance.Label + " (root)");
            }

            if (trigger != null)
            {
                stages.Add(trigger.Label);
            }

            if (childGuidance != null)
            {
                stages.Add(childGuidance.Label + " (child)");
            }

            if (splitter != null)
            {
                stages.Add(splitter.Label);
            }

            stages.Add(payload.Type == "explosion"
                ? "Explosion"
                : payload.Type == "pulse" ? "Native Pulse" : "Native Impact");
            string projectileWord = stats.ProjectileCount == 1 ? "projectile" : "projectiles";
            string capNote = compression > 0d
                ? " Output is compressed by the chassis power soft cap."
                : string.Empty;
            return string.Join(" -> ", stages)
                + $". {stats.ProjectileCount} {projectileWord} at {stats.PerChildPower} power each; "
                + $"{stats.EnergyCost} energy per shot.{capNote}";
        }

        private static void ValidateMegaRating(
            string key,
            int value,
            IList<BusterValidationIssue> errors)
        {
            if (value < BusterRuleset.TuningMinimum || value > BusterRuleset.TuningMaximum)
            {
                errors.Add(new BusterValidationIssue(
                    "INVALID_MEGA_TUNING_RATING",
                    "/resolvedTuning/" + key,
                    null,
                    $"{key} must be an integer from {BusterRuleset.TuningMinimum} through {BusterRuleset.TuningMaximum}."));
            }
        }
    }
}
