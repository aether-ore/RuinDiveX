using System;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Collider))]
    public sealed class DungeonSurfaceGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "surface-v2";
        [SerializeField] private string regionId = "region-v2";
        [SerializeField] private DungeonSurfaceKindV2 kind = DungeonSurfaceKindV2.Walkable;
        [SerializeField] private bool isStructural = true;
        [SerializeField] private bool isWalkable = true;
        [SerializeField] private string materialProfileId = "factory-floor";
        [SerializeField] private DungeonSurfacePredicateModeV2 activePredicateMode =
            DungeonSurfacePredicateModeV2.Always;
        [SerializeField] private DungeonSurfacePredicateClauseAuthoringV2[] activePredicateClauses =
            Array.Empty<DungeonSurfacePredicateClauseAuthoringV2>();
        [SerializeField] private string controllerId;

        public string StableId => stableId;
        public string RegionId => regionId;
        public DungeonSurfaceKindV2 Kind => kind;
        public bool IsStructural => isStructural;
        public bool IsWalkable => isWalkable;
        public string MaterialProfileId => materialProfileId;
        public DungeonAccessPredicateV2 ActivePredicate => BuildActivePredicate();
        public string ControllerId => string.IsNullOrWhiteSpace(controllerId) ? null : controllerId;

        public void Configure(
            string id,
            string owningRegionId,
            DungeonSurfaceKindV2 surfaceKind,
            bool structural,
            bool walkable,
            string materialProfile)
        {
            stableId = id;
            regionId = owningRegionId;
            kind = surfaceKind;
            isStructural = structural;
            isWalkable = walkable;
            materialProfileId = materialProfile;
            activePredicateMode = DungeonSurfacePredicateModeV2.Always;
            activePredicateClauses = Array.Empty<DungeonSurfacePredicateClauseAuthoringV2>();
            controllerId = null;
        }

        public void Configure(
            string id,
            string owningRegionId,
            DungeonSurfaceKindV2 surfaceKind,
            bool structural,
            bool walkable,
            string materialProfile,
            DungeonAccessPredicateV2 predicate,
            string owningControllerId)
        {
            Configure(id, owningRegionId, surfaceKind, structural, walkable, materialProfile);
            predicate ??= DungeonAccessPredicateV2.Always;
            controllerId = owningControllerId;
            if (PredicateHasOneEmptyClause(predicate))
            {
                activePredicateMode = DungeonSurfacePredicateModeV2.Always;
                return;
            }
            if (predicate.Clauses.Count == 0)
            {
                activePredicateMode = DungeonSurfacePredicateModeV2.Never;
                return;
            }

            activePredicateMode = DungeonSurfacePredicateModeV2.Clauses;
            activePredicateClauses = predicate.Clauses
                .Select(DungeonSurfacePredicateClauseAuthoringV2.FromCore)
                .ToArray();
        }

        private DungeonAccessPredicateV2 BuildActivePredicate()
        {
            switch (activePredicateMode)
            {
                case DungeonSurfacePredicateModeV2.Always:
                    return DungeonAccessPredicateV2.Always;
                case DungeonSurfacePredicateModeV2.Never:
                    return DungeonAccessPredicateV2.Never;
                case DungeonSurfacePredicateModeV2.Clauses:
                    return new DungeonAccessPredicateV2(
                        (activePredicateClauses ?? Array.Empty<DungeonSurfacePredicateClauseAuthoringV2>())
                            .Select(value => (value ?? throw new InvalidOperationException(
                                "Surface predicate clauses may not contain null entries.")).ToCore()));
                default:
                    throw new InvalidOperationException("Unknown certified surface predicate mode.");
            }
        }

        private static bool PredicateHasOneEmptyClause(DungeonAccessPredicateV2 predicate)
        {
            return predicate.Clauses.Count == 1 && predicate.Clauses[0].Conditions.Count == 0;
        }
    }

    public enum DungeonSurfacePredicateModeV2
    {
        Always,
        Never,
        Clauses
    }

    [Serializable]
    public sealed class DungeonSurfacePredicateClauseAuthoringV2
    {
        [SerializeField] private DungeonSurfacePredicateConditionAuthoringV2[] allOf =
            Array.Empty<DungeonSurfacePredicateConditionAuthoringV2>();

        public DungeonPredicateClauseV2 ToCore()
        {
            return new DungeonPredicateClauseV2(
                (allOf ?? Array.Empty<DungeonSurfacePredicateConditionAuthoringV2>())
                    .Select(value => (value ?? throw new InvalidOperationException(
                        "Surface predicate conditions may not contain null entries.")).ToCore()));
        }

        public static DungeonSurfacePredicateClauseAuthoringV2 FromCore(DungeonPredicateClauseV2 value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            return new DungeonSurfacePredicateClauseAuthoringV2
            {
                allOf = value.Conditions
                    .Select(DungeonSurfacePredicateConditionAuthoringV2.FromCore)
                    .ToArray()
            };
        }
    }

    [Serializable]
    public sealed class DungeonSurfacePredicateConditionAuthoringV2
    {
        [SerializeField] private DungeonPredicateConditionKindV2 kind;
        [SerializeField] private string subjectId;
        [SerializeField] private DungeonPredicateOperatorV2 predicateOperator;
        [SerializeField] private string expectedValue;

        public DungeonPredicateConditionV2 ToCore()
        {
            return new DungeonPredicateConditionV2(
                kind,
                subjectId,
                predicateOperator,
                string.IsNullOrWhiteSpace(expectedValue) ? null : expectedValue);
        }

        public static DungeonSurfacePredicateConditionAuthoringV2 FromCore(
            DungeonPredicateConditionV2 value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            return new DungeonSurfacePredicateConditionAuthoringV2
            {
                kind = value.Kind,
                subjectId = value.SubjectId,
                predicateOperator = value.Operator,
                expectedValue = value.ExpectedValue
            };
        }
    }
}
