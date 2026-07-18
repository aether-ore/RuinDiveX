using System;
using System.Collections.Generic;
using RuinCrawler.Core.Buster;

namespace RuinCrawler.Core.Campaign
{
    public sealed class BusterWorkshopResult
    {
        private BusterWorkshopResult(
            bool success,
            bool changed,
            bool idempotentReplay,
            string failureCode,
            string message,
            CampaignStateV1 state,
            CompiledBusterPlan plan,
            IReadOnlyList<BusterValidationIssue> validationIssues)
        {
            Success = success;
            Changed = changed;
            IdempotentReplay = idempotentReplay;
            FailureCode = failureCode;
            Message = message;
            State = state;
            Plan = plan;
            ValidationIssues = validationIssues ?? Array.Empty<BusterValidationIssue>();
        }

        public bool Success { get; }
        public bool Changed { get; }
        public bool IdempotentReplay { get; }
        public string FailureCode { get; }
        public string Message { get; }
        public CampaignStateV1 State { get; }
        public CompiledBusterPlan Plan { get; }
        public IReadOnlyList<BusterValidationIssue> ValidationIssues { get; }

        public static BusterWorkshopResult Succeeded(
            CampaignStateV1 state,
            CompiledBusterPlan plan,
            bool changed = true,
            bool idempotentReplay = false)
        {
            return new BusterWorkshopResult(true, changed, idempotentReplay, null, null, state, plan, null);
        }

        public static BusterWorkshopResult Failed(
            CampaignStateV1 original,
            string code,
            string message,
            IReadOnlyList<BusterValidationIssue> issues = null)
        {
            return new BusterWorkshopResult(false, false, false, code, message, original, null, issues);
        }
    }

    public static class BusterWorkshopService
    {
        public static BusterWorkshopResult ValidateDraft(CampaignStateV1 state, BusterSourceV1 draft)
        {
            if (state == null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            if (!TryConvert(draft, out BusterBuildSource source, out string conversionError))
            {
                return BusterWorkshopResult.Failed(state, "invalid-source", conversionError);
            }

            string ownershipFailure = ValidateOwnership(state, source);
            if (ownershipFailure != null)
            {
                return BusterWorkshopResult.Failed(state, "ownership-invalid", ownershipFailure);
            }

            if (!BusterCompiler.TryCompile(source, out CompiledBusterPlan plan, out BusterValidationResult validation))
            {
                return BusterWorkshopResult.Failed(
                    state,
                    "compile-failed",
                    "The Custom Buster graph is invalid.",
                    validation.Errors);
            }

            return BusterWorkshopResult.Succeeded(state, plan, changed: false);
        }

        public static BusterWorkshopResult MaterializeRevision(
            CampaignStateV1 sourceState,
            BusterSourceV1 draft,
            string transactionId,
            string committedAtUtc)
        {
            if (sourceState == null)
            {
                throw new ArgumentNullException(nameof(sourceState));
            }

            if (string.IsNullOrWhiteSpace(transactionId) || string.IsNullOrWhiteSpace(committedAtUtc))
            {
                return BusterWorkshopResult.Failed(sourceState, "invalid-transaction", "Transaction id and timestamp are required.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(sourceState.Clone());
            BusterRevisionHistoryV1 replay = FindTransaction(state, transactionId);
            if (replay != null)
            {
                BusterSourceV1 replaySource = replay.source?.Clone() ?? FindBuild(state, replay.buildId);
                BusterWorkshopResult validation = ValidateDraft(state, replaySource);
                return validation.Success
                    ? BusterWorkshopResult.Succeeded(state, validation.Plan, changed: false, idempotentReplay: true)
                    : validation;
            }

            BusterWorkshopResult checkedDraft = ValidateDraft(state, draft);
            if (!checkedDraft.Success)
            {
                return checkedDraft;
            }

            BusterSourceV1 existing = FindBuild(state, draft.buildId);
            long expectedRevision = existing?.revision ?? 0L;
            if (draft.revision != expectedRevision)
            {
                return BusterWorkshopResult.Failed(
                    sourceState,
                    "stale-build-revision",
                    "The Custom Buster changed after this draft was opened.");
            }

            BusterSourceV1 committed = draft.Clone();
            committed.revision = expectedRevision + 1L;
            int existingIndex = FindBuildIndex(state, draft.buildId);
            if (existingIndex >= 0)
            {
                state.busterSources[existingIndex] = committed;
            }
            else
            {
                state.busterSources.Add(committed);
                state.busterSources.Sort((left, right) => string.CompareOrdinal(left.buildId, right.buildId));
            }

            state.busterRevisionHistory.Add(new BusterRevisionHistoryV1
            {
                transactionId = transactionId.Trim(),
                buildId = committed.buildId,
                revision = committed.revision,
                committedAtUtc = committedAtUtc.Trim(),
                source = committed.Clone()
            });

            if (!TryConvert(committed, out BusterBuildSource committedSource, out _))
            {
                return BusterWorkshopResult.Failed(sourceState, "invalid-committed-source", "Committed source could not be reconstructed.");
            }

            CompiledBusterPlan committedPlan = BusterCompiler.Compile(committedSource);
            return BusterWorkshopResult.Succeeded(state, committedPlan);
        }

        public static BusterWorkshopResult AssignBuild(
            CampaignStateV1 sourceState,
            string buildId,
            string armSlotId,
            bool isSafeArea)
        {
            if (sourceState == null)
            {
                throw new ArgumentNullException(nameof(sourceState));
            }

            if (!isSafeArea)
            {
                return BusterWorkshopResult.Failed(sourceState, "unsafe-area", "Buster assignments can only change in a safe area.");
            }

            CampaignStateV1 state = CampaignStateRepair.Repair(sourceState.Clone());
            BusterSourceV1 build = FindBuild(state, buildId);
            if (build == null)
            {
                return BusterWorkshopResult.Failed(sourceState, "unknown-build", "The requested materialized Buster does not exist.");
            }

            BusterWorkshopResult validation = ValidateDraft(state, build);
            if (!validation.Success)
            {
                return validation;
            }

            string slot = string.IsNullOrWhiteSpace(armSlotId) ? "megaBuster" : armSlotId.Trim();
            string itemId = "buster:" + buildId;
            state.armAssignments.RemoveAll(value => value != null
                && (string.Equals(value.slotId, slot, StringComparison.Ordinal)
                    || string.Equals(value.itemId, itemId, StringComparison.Ordinal)));
            state.armAssignments.Add(new LoadoutAssignmentV1 { slotId = slot, itemId = itemId });
            state.armAssignments.Sort((left, right) => string.CompareOrdinal(left.slotId, right.slotId));
            return BusterWorkshopResult.Succeeded(state, validation.Plan);
        }

        public static bool TryConvert(BusterSourceV1 source, out BusterBuildSource build, out string error)
        {
            build = null;
            error = null;
            if (source == null || string.IsNullOrWhiteSpace(source.buildId)
                || string.IsNullOrWhiteSpace(source.chassisId))
            {
                error = "Build id and chassis id are required.";
                return false;
            }

            if (source.revision < 0L || source.revision > int.MaxValue)
            {
                error = "Build revision is outside the supported range.";
                return false;
            }

            var nodes = new List<BusterNodeSource>();
            foreach (BusterModuleSourceV1 module in source.modules ?? new List<BusterModuleSourceV1>())
            {
                nodes.Add(new BusterNodeSource(
                    module?.nodeId,
                    module?.moduleId,
                    module?.instanceId));
            }

            var edges = new List<BusterEdgeSource>();
            foreach (BusterEdgeSourceV1 edge in source.edges ?? new List<BusterEdgeSourceV1>())
            {
                edges.Add(new BusterEdgeSource(edge?.fromNodeId, edge?.port, edge?.toNodeId));
            }

            build = new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                string.IsNullOrWhiteSpace(source.rulesetVersion) ? BusterRuleset.RulesetVersion : source.rulesetVersion,
                source.buildId,
                source.chassisId,
                new BusterTuning(source.power, source.energy, source.range, source.rapid),
                new BusterProgramSource(source.rootNodeId, nodes, edges),
                (int)source.revision);
            return true;
        }

        private static string ValidateOwnership(CampaignStateV1 state, BusterBuildSource build)
        {
            if (!Contains(state.ownedChassisIds, build.ChassisId))
            {
                return "The chassis is not owned: " + build.ChassisId + ".";
            }

            var usedPhysicalModules = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < build.Program.Nodes.Count; index += 1)
            {
                BusterNodeSource node = build.Program.Nodes[index];
                BusterModuleDefinition definition = BusterModuleCatalog.Get(node.ModuleId);
                if (definition == null || !definition.Physical || definition.BuiltIn)
                {
                    continue;
                }

                if (!Contains(state.ownedModuleIds, node.ModuleId))
                {
                    return "The physical module is not owned: " + node.ModuleId + ".";
                }

                if (!usedPhysicalModules.Add(node.ModuleId))
                {
                    return "One physical module cannot occupy multiple graph nodes: " + node.ModuleId + ".";
                }
            }

            return null;
        }

        private static BusterSourceV1 FindBuild(CampaignStateV1 state, string buildId)
        {
            int index = FindBuildIndex(state, buildId);
            return index < 0 ? null : state.busterSources[index];
        }

        private static int FindBuildIndex(CampaignStateV1 state, string buildId)
        {
            for (int index = 0; index < state.busterSources.Count; index += 1)
            {
                if (string.Equals(state.busterSources[index]?.buildId, buildId, StringComparison.Ordinal))
                {
                    return index;
                }
            }

            return -1;
        }

        private static BusterRevisionHistoryV1 FindTransaction(CampaignStateV1 state, string transactionId)
        {
            for (int index = 0; index < state.busterRevisionHistory.Count; index += 1)
            {
                BusterRevisionHistoryV1 value = state.busterRevisionHistory[index];
                if (value != null && string.Equals(value.transactionId, transactionId, StringComparison.Ordinal))
                {
                    return value;
                }
            }

            return null;
        }

        private static bool Contains(List<string> values, string value)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.Equals(values[index], value, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
