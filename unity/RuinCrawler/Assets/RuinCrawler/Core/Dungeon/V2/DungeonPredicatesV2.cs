using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon.V2
{
    public enum DungeonPredicateConditionKindV2
    {
        RequiredItem,
        ControllerState,
        ShortcutState,
        DiscoveryFact,
        ProgressionFact,
        TraversalCapability
    }

    public enum DungeonPredicateOperatorV2
    {
        IsPresent,
        IsAbsent,
        Equals,
        NotEquals
    }

    public sealed class DungeonPredicateConditionV2
    {
        public DungeonPredicateConditionV2(
            DungeonPredicateConditionKindV2 kind,
            string subjectId,
            DungeonPredicateOperatorV2 @operator,
            string expectedValue = null)
        {
            Kind = kind;
            SubjectId = DungeonV2Contract.RequireId(subjectId, nameof(subjectId));
            Operator = @operator;

            bool isController = kind == DungeonPredicateConditionKindV2.ControllerState;
            bool isComparison = @operator == DungeonPredicateOperatorV2.Equals
                || @operator == DungeonPredicateOperatorV2.NotEquals;
            if (isController != isComparison)
            {
                throw new ArgumentException(
                    "Controller-state conditions require Equals/NotEquals; fact conditions require IsPresent/IsAbsent.",
                    nameof(@operator));
            }

            if (isController)
            {
                ExpectedValue = DungeonV2Contract.RequireId(expectedValue, nameof(expectedValue));
            }
            else if (expectedValue != null)
            {
                throw new ArgumentException("Fact conditions do not accept an expected value.", nameof(expectedValue));
            }
        }

        public DungeonPredicateConditionKindV2 Kind { get; }
        public string SubjectId { get; }
        public DungeonPredicateOperatorV2 Operator { get; }
        public string ExpectedValue { get; }
    }

    /// <summary>One conjunction in the predicate's canonical DNF representation.</summary>
    public sealed class DungeonPredicateClauseV2
    {
        public DungeonPredicateClauseV2(IEnumerable<DungeonPredicateConditionV2> allOf)
        {
            Conditions = DungeonV2Contract.CopyCanonical(
                allOf,
                BuildConditionKey,
                nameof(allOf));
        }

        public IReadOnlyList<DungeonPredicateConditionV2> Conditions { get; }

        internal string CanonicalKey
        {
            get
            {
                if (Conditions.Count == 0)
                {
                    return "<always>";
                }

                var parts = new string[Conditions.Count];
                for (int index = 0; index < Conditions.Count; index += 1)
                {
                    parts[index] = BuildConditionKey(Conditions[index]);
                }

                return string.Join("&", parts);
            }
        }

        private static string BuildConditionKey(DungeonPredicateConditionV2 condition)
        {
            return ((int)condition.Kind) + ":"
                + condition.SubjectId + ":"
                + ((int)condition.Operator) + ":"
                + (condition.ExpectedValue ?? string.Empty);
        }
    }

    /// <summary>
    /// Deterministic disjunctive-normal-form predicate. A clause is an all-of;
    /// the clause array is an any-of. No clauses means never. One empty clause
    /// means always.
    /// </summary>
    public sealed class DungeonAccessPredicateV2
    {
        public static readonly DungeonAccessPredicateV2 Always = new DungeonAccessPredicateV2(
            new[] { new DungeonPredicateClauseV2(Array.Empty<DungeonPredicateConditionV2>()) });

        public static readonly DungeonAccessPredicateV2 Never = new DungeonAccessPredicateV2(
            Array.Empty<DungeonPredicateClauseV2>());

        public DungeonAccessPredicateV2(IEnumerable<DungeonPredicateClauseV2> anyOf)
        {
            Clauses = DungeonV2Contract.CopyCanonical(
                anyOf,
                clause => clause.CanonicalKey,
                nameof(anyOf));
        }

        public IReadOnlyList<DungeonPredicateClauseV2> Clauses { get; }
    }

    public sealed class DungeonControllerStateFactV2
    {
        public DungeonControllerStateFactV2(string controllerId, string stateId)
        {
            ControllerId = DungeonV2Contract.RequireId(controllerId, nameof(controllerId));
            StateId = DungeonV2Contract.RequireId(stateId, nameof(stateId));
        }

        public string ControllerId { get; }
        public string StateId { get; }
    }

    /// <summary>Immutable input to the shared generation/runtime predicate evaluator.</summary>
    public sealed class DungeonPredicateStateV2
    {
        private readonly HashSet<string> requiredItems;
        private readonly Dictionary<string, string> controllerStates;
        private readonly HashSet<string> activeShortcuts;
        private readonly HashSet<string> discoveryFacts;
        private readonly HashSet<string> progressionFacts;
        private readonly HashSet<string> traversalCapabilities;

        public DungeonPredicateStateV2(
            IEnumerable<string> requiredItemIds,
            IEnumerable<DungeonControllerStateFactV2> controllerStateFacts,
            IEnumerable<string> activeShortcutIds,
            IEnumerable<string> discoveryFactIds,
            IEnumerable<string> progressionFactIds,
            IEnumerable<string> traversalCapabilityIds)
        {
            RequiredItemIds = DungeonV2Contract.CopyCanonicalIds(requiredItemIds, nameof(requiredItemIds));
            ControllerStates = DungeonV2Contract.CopyCanonical(
                controllerStateFacts,
                fact => fact.ControllerId,
                nameof(controllerStateFacts));
            ActiveShortcutIds = DungeonV2Contract.CopyCanonicalIds(activeShortcutIds, nameof(activeShortcutIds));
            DiscoveryFactIds = DungeonV2Contract.CopyCanonicalIds(discoveryFactIds, nameof(discoveryFactIds));
            ProgressionFactIds = DungeonV2Contract.CopyCanonicalIds(progressionFactIds, nameof(progressionFactIds));
            TraversalCapabilityIds = DungeonV2Contract.CopyCanonicalIds(
                traversalCapabilityIds,
                nameof(traversalCapabilityIds));

            requiredItems = new HashSet<string>(RequiredItemIds, StringComparer.Ordinal);
            activeShortcuts = new HashSet<string>(ActiveShortcutIds, StringComparer.Ordinal);
            discoveryFacts = new HashSet<string>(DiscoveryFactIds, StringComparer.Ordinal);
            progressionFacts = new HashSet<string>(ProgressionFactIds, StringComparer.Ordinal);
            traversalCapabilities = new HashSet<string>(TraversalCapabilityIds, StringComparer.Ordinal);
            controllerStates = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (DungeonControllerStateFactV2 fact in ControllerStates)
            {
                controllerStates.Add(fact.ControllerId, fact.StateId);
            }
        }

        public IReadOnlyList<string> RequiredItemIds { get; }
        public IReadOnlyList<DungeonControllerStateFactV2> ControllerStates { get; }
        public IReadOnlyList<string> ActiveShortcutIds { get; }
        public IReadOnlyList<string> DiscoveryFactIds { get; }
        public IReadOnlyList<string> ProgressionFactIds { get; }
        public IReadOnlyList<string> TraversalCapabilityIds { get; }

        internal bool HasRequiredItem(string id) => requiredItems.Contains(id);
        internal bool HasActiveShortcut(string id) => activeShortcuts.Contains(id);
        internal bool HasDiscoveryFact(string id) => discoveryFacts.Contains(id);
        internal bool HasProgressionFact(string id) => progressionFacts.Contains(id);
        internal bool HasTraversalCapability(string id) => traversalCapabilities.Contains(id);

        internal bool TryGetControllerState(string id, out string state)
        {
            return controllerStates.TryGetValue(id, out state);
        }
    }

    public static class DungeonPredicateEvaluatorV2
    {
        public static bool Evaluate(DungeonAccessPredicateV2 predicate, DungeonPredicateStateV2 state)
        {
            if (predicate == null)
            {
                throw new ArgumentNullException(nameof(predicate));
            }

            if (state == null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            foreach (DungeonPredicateClauseV2 clause in predicate.Clauses)
            {
                bool clauseMatches = true;
                foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                {
                    if (!Evaluate(condition, state))
                    {
                        clauseMatches = false;
                        break;
                    }
                }

                if (clauseMatches)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool Evaluate(DungeonPredicateConditionV2 condition, DungeonPredicateStateV2 state)
        {
            bool present;
            switch (condition.Kind)
            {
                case DungeonPredicateConditionKindV2.RequiredItem:
                    present = state.HasRequiredItem(condition.SubjectId);
                    return condition.Operator == DungeonPredicateOperatorV2.IsPresent ? present : !present;

                case DungeonPredicateConditionKindV2.ShortcutState:
                    present = state.HasActiveShortcut(condition.SubjectId);
                    return condition.Operator == DungeonPredicateOperatorV2.IsPresent ? present : !present;

                case DungeonPredicateConditionKindV2.DiscoveryFact:
                    present = state.HasDiscoveryFact(condition.SubjectId);
                    return condition.Operator == DungeonPredicateOperatorV2.IsPresent ? present : !present;

                case DungeonPredicateConditionKindV2.ProgressionFact:
                    present = state.HasProgressionFact(condition.SubjectId);
                    return condition.Operator == DungeonPredicateOperatorV2.IsPresent ? present : !present;

                case DungeonPredicateConditionKindV2.TraversalCapability:
                    present = state.HasTraversalCapability(condition.SubjectId);
                    return condition.Operator == DungeonPredicateOperatorV2.IsPresent ? present : !present;

                case DungeonPredicateConditionKindV2.ControllerState:
                    bool found = state.TryGetControllerState(condition.SubjectId, out string actualState);
                    bool equals = found && string.Equals(actualState, condition.ExpectedValue, StringComparison.Ordinal);
                    return condition.Operator == DungeonPredicateOperatorV2.Equals ? equals : !equals;

                default:
                    throw new ArgumentOutOfRangeException(nameof(condition.Kind), condition.Kind, "Unknown condition kind.");
            }
        }
    }
}
