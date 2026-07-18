using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Deterministic translation-only placement of a certified local module
    /// bake into plan space. V2 currently permits no module rotation or scale.
    /// </summary>
    public sealed class DungeonCertifiedModulePlacementV2
    {
        public DungeonCertifiedModulePlacementV2(
            CertifiedDungeonModuleGeometryV2 source,
            string moduleInstanceId,
            IReadOnlyDictionary<string, string> placedRegionIds,
            DungeonPoint3 translation,
            string hazardControllerId = null)
        {
            Source = source ?? throw new ArgumentNullException(nameof(source));
            ModuleInstanceId = DungeonV2Contract.RequireId(moduleInstanceId, nameof(moduleInstanceId));
            Translation = translation;
            if (placedRegionIds == null) throw new ArgumentNullException(nameof(placedRegionIds));

            var regionMap = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (CertifiedDungeonRegionGeometryV2 region in source.Regions)
            {
                if (!placedRegionIds.TryGetValue(region.Id, out string placedId))
                {
                    throw new ArgumentException(
                        "No placed region ID was supplied for certified local region '" + region.Id + "'.",
                        nameof(placedRegionIds));
                }
                regionMap.Add(region.Id, DungeonV2Contract.RequireId(placedId, nameof(placedRegionIds)));
            }
            if (regionMap.Count != placedRegionIds.Count)
            {
                throw new ArgumentException("Placed region map contains IDs not present in the certified bake.", nameof(placedRegionIds));
            }

            RegionIds = new ReadOnlyDictionary<string, string>(regionMap);
            Regions = Array.AsReadOnly(source.Regions.Select(value =>
                new CertifiedDungeonRegionGeometryV2(
                    regionMap[value.Id],
                    Translate(value.Bounds, translation),
                    value.DistrictKind,
                    value.ElevationStratum,
                    PlacedNavigationRegionId(regionMap[value.Id], value.LocalNavigationRegionId))).ToArray());
            Surfaces = Array.AsReadOnly(source.Surfaces.Select(value =>
                new DungeonSurfacePlanV2(
                    PlacedSurfaceId(regionMap[value.RegionId], value.Id),
                    ModuleInstanceId,
                    regionMap[value.RegionId],
                    value.Kind,
                    Translate(value.Volume, translation),
                    value.MaterialProfileId,
                    value.IsStructural,
                    value.IsWalkable,
                    DungeonAccessPredicateV2.Always,
                    value.Kind == DungeonSurfaceKindV2.Hazard ? hazardControllerId : null,
                    DungeonSpatialRecordSourceV2.CertifiedModule)).ToArray());
            Anchors = Array.AsReadOnly(source.Anchors.Select(value =>
                new DungeonAnchorPlanV2(
                    PlacedAnchorId(regionMap[value.RegionId], value.Id),
                    ModuleInstanceId,
                    regionMap[value.RegionId],
                    value.Kind,
                    Translate(value.Position, translation),
                    value.ProfileId,
                    DungeonSpatialRecordSourceV2.CertifiedModule)).ToArray());
            Connectors = Array.AsReadOnly(source.Connectors.Select(value =>
                new DungeonModuleConnectorPlanV2(
                    PlacedConnectorId(regionMap[value.RegionId], value.Id),
                    ModuleInstanceId,
                    regionMap[value.RegionId],
                    value.Kind,
                    Translate(value.Position, translation),
                    value.Facing,
                    value.SocketTag,
                    DungeonAccessPredicateV2.Always,
                    DungeonSpatialRecordSourceV2.CertifiedModule)).ToArray());
            Bounds = Union(Regions.Select(value => value.Bounds));
        }

        public CertifiedDungeonModuleGeometryV2 Source { get; }
        public string ModuleInstanceId { get; }
        public IReadOnlyDictionary<string, string> RegionIds { get; }
        public DungeonPoint3 Translation { get; }
        public DungeonBounds3 Bounds { get; }
        public IReadOnlyList<CertifiedDungeonRegionGeometryV2> Regions { get; }
        public IReadOnlyList<DungeonSurfacePlanV2> Surfaces { get; }
        public IReadOnlyList<DungeonAnchorPlanV2> Anchors { get; }
        public IReadOnlyList<DungeonModuleConnectorPlanV2> Connectors { get; }

        public static DungeonCertifiedModulePlacementV2 PlaceSingleRegion(
            IndustrialFactoryV2ModuleDefinition definition,
            string moduleInstanceId,
            string placedRegionId,
            DungeonBounds3 desiredBounds,
            string hazardControllerId = null)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            if (definition.CertifiedGeometry.Regions.Count != 1)
            {
                throw new InvalidOperationException(
                    "PlaceSingleRegion requires exactly one certified region for template '"
                        + definition.TemplateId + "'.");
            }

            CertifiedDungeonRegionGeometryV2 local = definition.CertifiedGeometry.Regions[0];
            var translation = new DungeonPoint3(
                desiredBounds.Minimum.X - local.Bounds.Minimum.X,
                desiredBounds.Minimum.Y - local.Bounds.Minimum.Y,
                desiredBounds.Minimum.Z - local.Bounds.Minimum.Z);
            DungeonBounds3 translated = Translate(local.Bounds, translation);
            if (!BoundsEqual(translated, desiredBounds, 1e-9d))
            {
                throw new InvalidOperationException(
                    "Certified geometry footprint for '" + definition.TemplateId
                        + "' does not match the requested placement bounds.");
            }

            return new DungeonCertifiedModulePlacementV2(
                definition.CertifiedGeometry,
                moduleInstanceId,
                new Dictionary<string, string>(StringComparer.Ordinal) { { local.Id, placedRegionId } },
                translation,
                hazardControllerId);
        }

        public static string PlacedSurfaceId(string placedRegionId, string localId)
        {
            placedRegionId = DungeonV2Contract.RequireId(placedRegionId, nameof(placedRegionId));
            localId = DungeonV2Contract.RequireId(localId, nameof(localId));
            return localId == "floor" || localId == "tower-floor-north"
                ? "surface-" + placedRegionId
                : "surface-certified-" + placedRegionId + "-" + localId;
        }

        public static string PlacedAnchorId(string placedRegionId, string localId) =>
            "anchor-" + DungeonV2Contract.RequireId(placedRegionId, nameof(placedRegionId))
                + "-" + DungeonV2Contract.RequireId(localId, nameof(localId));

        public static string PlacedConnectorId(string placedRegionId, string localId) =>
            "connector-" + DungeonV2Contract.RequireId(placedRegionId, nameof(placedRegionId))
                + "-" + DungeonV2Contract.RequireId(localId, nameof(localId));

        public static string PlacedNavigationRegionId(string placedRegionId, string localId) =>
            DungeonV2Contract.RequireId(localId, nameof(localId)) + "-"
                + DungeonV2Contract.RequireId(placedRegionId, nameof(placedRegionId));

        public static DungeonPoint3 Translate(DungeonPoint3 value, DungeonPoint3 translation) =>
            new DungeonPoint3(value.X + translation.X, value.Y + translation.Y, value.Z + translation.Z);

        public static DungeonBounds3 Translate(DungeonBounds3 value, DungeonPoint3 translation) =>
            new DungeonBounds3(Translate(value.Minimum, translation), Translate(value.Maximum, translation));

        public static DungeonConvexPrismV2 Translate(DungeonConvexPrismV2 value, DungeonPoint3 translation)
        {
            return new DungeonConvexPrismV2(
                value.HorizontalVertices.Select(point =>
                    new DungeonPoint2V2(point.X + translation.X, point.Z + translation.Z)),
                value.MinimumY + translation.Y,
                value.MaximumY + translation.Y);
        }

        internal static bool BoundsEqual(DungeonBounds3 left, DungeonBounds3 right, double tolerance) =>
            PointEqual(left.Minimum, right.Minimum, tolerance) && PointEqual(left.Maximum, right.Maximum, tolerance);

        internal static bool PointEqual(DungeonPoint3 left, DungeonPoint3 right, double tolerance) =>
            Math.Abs(left.X - right.X) <= tolerance
                && Math.Abs(left.Y - right.Y) <= tolerance
                && Math.Abs(left.Z - right.Z) <= tolerance;

        internal static bool PrismEqual(DungeonConvexPrismV2 left, DungeonConvexPrismV2 right, double tolerance)
        {
            if (left.HorizontalVertices.Count != right.HorizontalVertices.Count
                || Math.Abs(left.MinimumY - right.MinimumY) > tolerance
                || Math.Abs(left.MaximumY - right.MaximumY) > tolerance)
            {
                return false;
            }
            for (int index = 0; index < left.HorizontalVertices.Count; index += 1)
            {
                if (Math.Abs(left.HorizontalVertices[index].X - right.HorizontalVertices[index].X) > tolerance
                    || Math.Abs(left.HorizontalVertices[index].Z - right.HorizontalVertices[index].Z) > tolerance)
                {
                    return false;
                }
            }
            return true;
        }

        private static DungeonBounds3 Union(IEnumerable<DungeonBounds3> values)
        {
            DungeonBounds3[] copy = values.ToArray();
            if (copy.Length == 0) throw new ArgumentException("At least one region bound is required.", nameof(values));
            return new DungeonBounds3(
                new DungeonPoint3(
                    copy.Min(value => value.Minimum.X),
                    copy.Min(value => value.Minimum.Y),
                    copy.Min(value => value.Minimum.Z)),
                new DungeonPoint3(
                    copy.Max(value => value.Maximum.X),
                    copy.Max(value => value.Maximum.Y),
                    copy.Max(value => value.Maximum.Z)));
        }
    }

    /// <summary>
    /// Proves that the module-owned records in a plan are the exact translated
    /// certified bake. Hash equality alone is deliberately insufficient.
    /// </summary>
    public static class DungeonCertifiedModulePlacementValidatorV2
    {
        public const double GeometryTolerance = 1e-9d;

        public static IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
            {
                if (!IndustrialFactoryV2ModuleCatalog.TryGet(module.TemplateId, out IndustrialFactoryV2ModuleDefinition definition))
                {
                    errors.Add(Issue("CERTIFIED_TEMPLATE_UNKNOWN", module.Id, "Unknown certified template '" + module.TemplateId + "'."));
                    continue;
                }
                ValidateModule(plan, module, definition.CertifiedGeometry, errors);
            }
            return Array.AsReadOnly(errors.ToArray());
        }

        public static IReadOnlyList<IndustrialFactoryV2ValidationIssue> ValidateModule(
            DungeonPlanV2 plan,
            DungeonModuleInstancePlanV2 module,
            CertifiedDungeonModuleGeometryV2 geometry)
        {
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            ValidateModule(plan, module, geometry, errors);
            return Array.AsReadOnly(errors.ToArray());
        }

        private static void ValidateModule(
            DungeonPlanV2 plan,
            DungeonModuleInstancePlanV2 module,
            CertifiedDungeonModuleGeometryV2 geometry,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            CertifiedDungeonGeometryValidationResultV2 identity = geometry.ValidateModuleInstance(module);
            if (!identity.IsValid)
            {
                errors.Add(Issue("CERTIFIED_IDENTITY_MISMATCH", module.Id, identity.Message));
                return;
            }
            if (geometry.Regions.Count != module.RegionIds.Count)
            {
                errors.Add(Issue("CERTIFIED_REGION_COUNT_MISMATCH", module.Id, "Placed region count differs from the certified bake."));
                return;
            }

            var regionMap = new Dictionary<string, string>(StringComparer.Ordinal);
            if (geometry.Regions.Count == 1)
            {
                regionMap.Add(geometry.Regions[0].Id, module.RegionIds[0]);
            }
            else
            {
                foreach (CertifiedDungeonRegionGeometryV2 local in geometry.Regions)
                {
                    string id = module.Id + "/certified-region/" + local.Id;
                    if (!module.RegionIds.Contains(id))
                    {
                        errors.Add(Issue("CERTIFIED_REGION_MISSING", module.Id, "Missing placed region for local ID '" + local.Id + "'."));
                        return;
                    }
                    regionMap.Add(local.Id, id);
                }
            }

            CertifiedDungeonRegionGeometryV2 first = geometry.Regions[0];
            DungeonRegionPlanV2 firstPlaced = plan.Regions.Single(value => value.Id == regionMap[first.Id]);
            var translation = new DungeonPoint3(
                firstPlaced.Bounds.Minimum.X - first.Bounds.Minimum.X,
                firstPlaced.Bounds.Minimum.Y - first.Bounds.Minimum.Y,
                firstPlaced.Bounds.Minimum.Z - first.Bounds.Minimum.Z);
            var placement = new DungeonCertifiedModulePlacementV2(
                geometry,
                module.Id,
                regionMap,
                translation,
                IndustrialFactoryV2Ruleset.HazardControllerId);

            if (!DungeonCertifiedModulePlacementV2.BoundsEqual(module.Bounds, placement.Bounds, GeometryTolerance))
                errors.Add(Issue("CERTIFIED_MODULE_BOUNDS_MISMATCH", module.Id, "Module bounds do not equal the transformed certified region union."));

            foreach (CertifiedDungeonRegionGeometryV2 expected in placement.Regions)
            {
                DungeonRegionPlanV2 actual = plan.Regions.FirstOrDefault(value => value.Id == expected.Id);
                DungeonBiomeDistrictPlanV2 district = actual == null ? null : plan.Districts.FirstOrDefault(value => value.Id == actual.BiomeDistrictId);
                if (actual == null || actual.Source != DungeonSpatialRecordSourceV2.CertifiedModule
                    || !DungeonCertifiedModulePlacementV2.BoundsEqual(actual.Bounds, expected.Bounds, GeometryTolerance)
                    || actual.ElevationStratum != expected.ElevationStratum
                    || actual.LocalNavigationRegionId != expected.LocalNavigationRegionId
                    || district == null || district.Kind != expected.DistrictKind)
                {
                    errors.Add(Issue("CERTIFIED_REGION_PLACEMENT_MISMATCH", module.Id, "Placed region '" + expected.Id + "' does not match the transformed bake."));
                }
            }

            CompareExactSet(
                plan.Surfaces.Where(value => value.ModuleInstanceId == module.Id && value.Source == DungeonSpatialRecordSourceV2.CertifiedModule),
                placement.Surfaces,
                value => value.Id,
                (actual, expected) => actual.RegionId == expected.RegionId
                    && actual.Kind == expected.Kind
                    && actual.MaterialProfileId == expected.MaterialProfileId
                    && actual.IsStructural == expected.IsStructural
                    && actual.IsWalkable == expected.IsWalkable
                    && string.Equals(actual.ControllerId, expected.ControllerId, StringComparison.Ordinal)
                    && PredicateEqual(actual.ActivePredicate, expected.ActivePredicate)
                    && DungeonCertifiedModulePlacementV2.PrismEqual(actual.Volume, expected.Volume, GeometryTolerance),
                "CERTIFIED_SURFACE_PLACEMENT_MISMATCH",
                module.Id,
                errors);
            CompareExactSet(
                plan.Anchors.Where(value => value.ModuleInstanceId == module.Id && value.Source == DungeonSpatialRecordSourceV2.CertifiedModule),
                placement.Anchors,
                value => value.Id,
                (actual, expected) => actual.RegionId == expected.RegionId
                    && actual.Kind == expected.Kind
                    && actual.ProfileId == expected.ProfileId
                    && DungeonCertifiedModulePlacementV2.PointEqual(actual.Position, expected.Position, GeometryTolerance),
                "CERTIFIED_ANCHOR_PLACEMENT_MISMATCH",
                module.Id,
                errors);
            CompareExactSet(
                plan.Connectors.Where(value => value.ModuleInstanceId == module.Id && value.Source == DungeonSpatialRecordSourceV2.CertifiedModule),
                placement.Connectors,
                value => value.Id,
                (actual, expected) => actual.RegionId == expected.RegionId
                    && actual.Kind == expected.Kind
                    && actual.SocketTag == expected.SocketTag
                    && PredicateEqual(actual.AccessPredicate, expected.AccessPredicate)
                    && DungeonCertifiedModulePlacementV2.PointEqual(actual.Position, expected.Position, GeometryTolerance)
                    && DungeonCertifiedModulePlacementV2.PointEqual(actual.Facing, expected.Facing, GeometryTolerance),
                "CERTIFIED_CONNECTOR_PLACEMENT_MISMATCH",
                module.Id,
                errors);
        }

        private static void CompareExactSet<T>(
            IEnumerable<T> actualValues,
            IEnumerable<T> expectedValues,
            Func<T, string> id,
            Func<T, T, bool> equal,
            string code,
            string moduleId,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            Dictionary<string, T> actual = actualValues.ToDictionary(id, StringComparer.Ordinal);
            Dictionary<string, T> expected = expectedValues.ToDictionary(id, StringComparer.Ordinal);
            foreach (string recordId in actual.Keys.Union(expected.Keys, StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                if (!actual.TryGetValue(recordId, out T left)
                    || !expected.TryGetValue(recordId, out T right)
                    || !equal(left, right))
                {
                    errors.Add(Issue(code, moduleId, "Certified record '" + recordId + "' is missing, extra, or differs from the transformed bake."));
                }
            }
        }

        private static bool PredicateEqual(
            DungeonAccessPredicateV2 left,
            DungeonAccessPredicateV2 right)
        {
            if (ReferenceEquals(left, right)) return true;
            if (left == null || right == null || left.Clauses.Count != right.Clauses.Count) return false;
            for (int clauseIndex = 0; clauseIndex < left.Clauses.Count; clauseIndex += 1)
            {
                IReadOnlyList<DungeonPredicateConditionV2> leftConditions =
                    left.Clauses[clauseIndex].Conditions;
                IReadOnlyList<DungeonPredicateConditionV2> rightConditions =
                    right.Clauses[clauseIndex].Conditions;
                if (leftConditions.Count != rightConditions.Count) return false;
                for (int conditionIndex = 0; conditionIndex < leftConditions.Count; conditionIndex += 1)
                {
                    DungeonPredicateConditionV2 leftCondition = leftConditions[conditionIndex];
                    DungeonPredicateConditionV2 rightCondition = rightConditions[conditionIndex];
                    if (leftCondition.Kind != rightCondition.Kind
                        || leftCondition.Operator != rightCondition.Operator
                        || !string.Equals(
                            leftCondition.SubjectId,
                            rightCondition.SubjectId,
                            StringComparison.Ordinal)
                        || !string.Equals(
                            leftCondition.ExpectedValue,
                            rightCondition.ExpectedValue,
                            StringComparison.Ordinal))
                    {
                        return false;
                    }
                }
            }

            return true;
        }

        private static IndustrialFactoryV2ValidationIssue Issue(string code, string moduleId, string message) =>
            new IndustrialFactoryV2ValidationIssue(code, "/modules/" + moduleId + "/certifiedPlacement", message);
    }
}
