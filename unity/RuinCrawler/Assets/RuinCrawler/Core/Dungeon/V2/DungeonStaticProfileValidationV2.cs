using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Profile-level checks which are deliberately independent of scene objects:
    /// certified walkable boundaries, timed electrical crossing geometry, and
    /// the traversal-capability allow-list all consume the immutable V2 plan.
    /// </summary>
    public sealed class IndustrialFactoryV2StaticProfileValidator
    {
        private const double GeometryEpsilon = 1e-9d;
        private const double BoundaryProbeDistance = 0.05d;
        private const double MinimumBoundaryLength = 0.05d;
        private const double SafeIslandErosion = 0.52d;

        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));

            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            ValidateTraversalCapabilityAllowList(plan, errors);
            ValidateReservedDiscoveryKinds(plan, errors);
            ValidateDerivedExposedBoundaries(plan, errors);
            ValidateElectricCrossingGeometry(plan, errors);
            return Array.AsReadOnly(errors.ToArray());
        }

        private static void ValidateReservedDiscoveryKinds(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                if (discovery.Kind != DungeonDiscoveryKindV2.ZennyCache
                    && discovery.Kind != DungeonDiscoveryKindV2.RefractorCache)
                {
                    continue;
                }

                Add(
                    errors,
                    "DISCOVERY_KIND_LEDGER_UNAVAILABLE",
                    "/discoveries/" + discovery.Id,
                    discovery.Kind + " is reserved until its transactional campaign ledger is implemented.");
            }
        }

        private static void ValidateTraversalCapabilityAllowList(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            foreach (PredicatePath entry in EnumeratePredicates(plan))
            {
                foreach (DungeonPredicateClauseV2 clause in entry.Predicate.Clauses)
                foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                {
                    if (condition.Kind != DungeonPredicateConditionKindV2.TraversalCapability
                        || IndustrialFactoryV2Ruleset.IsAllowedTraversalCapability(condition.SubjectId))
                    {
                        continue;
                    }

                    Add(
                        errors,
                        "TRAVERSAL_CAPABILITY_NOT_ALLOWED",
                        entry.Path,
                        "Traversal capability '" + condition.SubjectId
                            + "' is not certified for industrial-factory-v2. Only dry and flooded bottom-walk profiles are allowed.");
                }
            }
        }

        private static IEnumerable<PredicatePath> EnumeratePredicates(DungeonPlanV2 plan)
        {
            foreach (DungeonModuleConnectorPlanV2 connector in plan.Connectors)
                yield return new PredicatePath("/connectors/" + connector.Id + "/accessPredicate", connector.AccessPredicate);
            foreach (DungeonRegionPlanV2 region in plan.Regions)
            foreach (DungeonEnvironmentSupportPlanV2 support in region.SupportedEnvironmentStates)
                yield return new PredicatePath(
                    "/regions/" + region.Id + "/supportedEnvironmentStates/" + support.Id,
                    support.Predicate);
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
                yield return new PredicatePath("/traversalEdges/" + edge.Id + "/accessPredicate", edge.AccessPredicate);
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes)
            {
                yield return new PredicatePath("/routes/" + route.Id + "/requiredPredicate", route.RequiredPredicate);
                foreach (DungeonAuthorizedExitPlanV2 exit in route.AuthorizedExits)
                    yield return new PredicatePath(
                        "/routes/" + route.Id + "/authorizedExits/" + exit.Id,
                        exit.EarliestAuthorizationPredicate);
            }
            foreach (DungeonDiscoveryPlanV2 discovery in plan.Discoveries)
            {
                yield return new PredicatePath("/discoveries/" + discovery.Id + "/accessPredicate", discovery.AccessPredicate);
                yield return new PredicatePath("/discoveries/" + discovery.Id + "/revealPredicate", discovery.RevealPredicate);
            }
            foreach (DungeonShortcutPlanV2 shortcut in plan.Shortcuts)
            {
                yield return new PredicatePath(
                    "/shortcuts/" + shortcut.Id + "/earliestAuthorizationPredicate",
                    shortcut.EarliestAuthorizationPredicate);
                yield return new PredicatePath(
                    "/shortcuts/" + shortcut.Id + "/environmentStatePredicate",
                    shortcut.EnvironmentStatePredicate);
            }
            foreach (DungeonSurfacePlanV2 surface in plan.Surfaces)
                yield return new PredicatePath("/surfaces/" + surface.Id + "/activePredicate", surface.ActivePredicate);
            foreach (DungeonEnvironmentControllerPlanV2 controller in plan.EnvironmentControllers)
            foreach (DungeonControllerTransitionPlanV2 transition in controller.Transitions)
                yield return new PredicatePath(
                    "/environmentControllers/" + controller.Id + "/transitions/" + transition.Id,
                    transition.ActivationPredicate);
        }

        private static void ValidateDerivedExposedBoundaries(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            foreach (BoundarySegment segment in DeriveUncoveredBoundaries(plan))
            {
                Add(
                    errors,
                    "EXPOSED_BOUNDARY_UNCOVERED",
                    "/surfaces/" + segment.SourceSurfaceId,
                    "Derived walkable boundary " + Format(segment.Start) + " -> " + Format(segment.End)
                        + " is not protected by certified structural geometry, a certified traversal continuation, or a registered fall exposure.");
            }
        }

        private static IEnumerable<BoundarySegment> DeriveUncoveredBoundaries(DungeonPlanV2 plan)
        {
            DungeonSurfacePlanV2[] sources = plan.Surfaces
                .Where(IsBoundarySource)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            foreach (DungeonSurfacePlanV2 source in sources)
            {
                IReadOnlyList<DungeonPoint2V2> polygon = source.Volume.HorizontalVertices;
                double winding = Math.Sign(SignedAreaTwice(polygon));
                double top = source.Volume.MaximumY;
                for (int edgeIndex = 0; edgeIndex < polygon.Count; edgeIndex += 1)
                {
                    DungeonPoint2V2 start = polygon[edgeIndex];
                    DungeonPoint2V2 end = polygon[(edgeIndex + 1) % polygon.Count];
                    double dx = end.X - start.X;
                    double dz = end.Z - start.Z;
                    double length = Math.Sqrt(dx * dx + dz * dz);
                    if (length <= MinimumBoundaryLength) continue;

                    double outwardX = winding > 0d ? dz / length : -dz / length;
                    double outwardZ = winding > 0d ? -dx / length : dx / length;
                    var protectedIntervals = new List<Interval>();

                    foreach (DungeonSurfacePlanV2 barrier in plan.Surfaces)
                    {
                        if (!IsCertifiedBarrier(barrier, source, top)
                            || !TryClipSegmentToConvex(start, end, barrier.Volume.HorizontalVertices, out Interval interval))
                        {
                            continue;
                        }
                        protectedIntervals.Add(interval);
                    }

                    var offsetStart = new DungeonPoint2V2(
                        start.X + outwardX * BoundaryProbeDistance,
                        start.Z + outwardZ * BoundaryProbeDistance);
                    var offsetEnd = new DungeonPoint2V2(
                        end.X + outwardX * BoundaryProbeDistance,
                        end.Z + outwardZ * BoundaryProbeDistance);
                    foreach (DungeonSurfacePlanV2 continuation in plan.Surfaces)
                    {
                        if (!IsCertifiedWalkableContinuation(continuation, source, top)
                            || !TryClipSegmentToConvex(
                                offsetStart,
                                offsetEnd,
                                continuation.Volume.HorizontalVertices,
                                out Interval interval))
                        {
                            continue;
                        }
                        protectedIntervals.Add(interval);
                    }

                    foreach (BoundarySegment fragment in SubtractIntervals(
                        source.Id,
                        source.RegionId,
                        start,
                        end,
                        top,
                        protectedIntervals))
                    {
                        if (IsCertifiedTraversalAperture(plan, fragment, outwardX, outwardZ)
                            || IsCoveredByRegisteredExposure(plan, fragment))
                        {
                            continue;
                        }

                        yield return fragment;
                    }
                }
            }
        }

        private static bool IsBoundarySource(DungeonSurfacePlanV2 surface)
        {
            return surface.IsStructural
                && surface.IsWalkable
                && surface.Kind != DungeonSurfaceKindV2.Hazard;
        }

        private static bool IsCertifiedBarrier(
            DungeonSurfacePlanV2 candidate,
            DungeonSurfacePlanV2 source,
            double sourceTop)
        {
            if (string.Equals(candidate.Id, source.Id, StringComparison.Ordinal)
                || !candidate.IsStructural
                || candidate.IsWalkable
                || (!IsAlways(candidate.ActivePredicate)
                    && !ReferenceEquals(candidate.ActivePredicate, source.ActivePredicate))
                || candidate.Volume.MinimumY > sourceTop + 0.1d
                || candidate.Volume.MaximumY < sourceTop + 0.5d)
            {
                return false;
            }

            return candidate.Kind == DungeonSurfaceKindV2.Rail
                || candidate.Kind == DungeonSurfaceKindV2.DoorSweep
                || candidate.Kind == DungeonSurfaceKindV2.SolidOccupancy
                || candidate.Kind == DungeonSurfaceKindV2.Structural;
        }

        private static bool IsCertifiedWalkableContinuation(
            DungeonSurfacePlanV2 candidate,
            DungeonSurfacePlanV2 source,
            double sourceTop)
        {
            if (string.Equals(candidate.Id, source.Id, StringComparison.Ordinal)
                || !candidate.IsStructural
                || !candidate.IsWalkable
                || candidate.Kind == DungeonSurfaceKindV2.Hazard
                || !IsAlways(candidate.ActivePredicate))
            {
                return false;
            }

            double rise = candidate.Volume.MaximumY - sourceTop;
            return rise >= -TraversalProfilesV2.Dry.SafeDropEnvelope - GeometryEpsilon
                && rise <= TraversalProfilesV2.Flooded.MaximumLedgeCatchRise + GeometryEpsilon;
        }

        private static bool IsCertifiedTraversalAperture(
            DungeonPlanV2 plan,
            BoundarySegment segment,
            double outwardX,
            double outwardZ)
        {
            var pairedConnectorIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 edge in plan.AbstractRouteGraph.Edges)
            {
                pairedConnectorIds.Add(edge.FromConnectorId);
                pairedConnectorIds.Add(edge.ToConnectorId);
            }

            var midpoint = new DungeonPoint2V2(
                (segment.Start.X + segment.End.X) * 0.5d,
                (segment.Start.Z + segment.End.Z) * 0.5d);
            foreach (DungeonModuleConnectorPlanV2 connector in plan.Connectors)
            {
                DungeonConnectorApertureV2 aperture = connector.Aperture;
                if (!string.Equals(connector.RegionId, segment.SourceRegionId, StringComparison.Ordinal)
                    || aperture == null
                    || segment.SurfaceTopY < aperture.LocalVolume.MinimumY - GeometryEpsilon
                    || segment.SurfaceTopY > aperture.LocalVolume.MaximumY + GeometryEpsilon
                    || connector.Facing.X * outwardX + connector.Facing.Z * outwardZ < 0.9d
                    || !PointInsideConvex(segment.Start, aperture.LocalVolume.HorizontalVertices)
                    || !PointInsideConvex(midpoint, aperture.LocalVolume.HorizontalVertices)
                    || !PointInsideConvex(segment.End, aperture.LocalVolume.HorizontalVertices))
                {
                    continue;
                }

                if (pairedConnectorIds.Contains(connector.Id)
                    || aperture.CapState == DungeonConnectorCapStateV2.RequiredWhenUnused)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsCoveredByRegisteredExposure(DungeonPlanV2 plan, BoundarySegment segment)
        {
            foreach (DungeonFallExposurePlanV2 exposure in plan.FallExposures)
            {
                if (!string.Equals(exposure.SourceSurfaceId, segment.SourceSurfaceId, StringComparison.Ordinal)
                    || (exposure.Causes & (DungeonFallExposureCauseV2.Walk
                        | DungeonFallExposureCauseV2.Crumble
                        | DungeonFallExposureCauseV2.MovingSurfaceFailure)) == 0
                    || exposure.SourceVolume.MinimumY > segment.SurfaceTopY + GeometryEpsilon
                    || exposure.SourceVolume.MaximumY + GeometryEpsilon < segment.SurfaceTopY
                    || !PointInsideConvex(segment.Start, exposure.SourceVolume.HorizontalVertices)
                    || !PointInsideConvex(segment.End, exposure.SourceVolume.HorizontalVertices))
                {
                    continue;
                }

                return true;
            }

            return false;
        }

        private static IEnumerable<BoundarySegment> SubtractIntervals(
            string sourceSurfaceId,
            string sourceRegionId,
            DungeonPoint2V2 start,
            DungeonPoint2V2 end,
            double top,
            IEnumerable<Interval> protectedIntervals)
        {
            Interval[] merged = MergeIntervals(protectedIntervals).ToArray();
            double cursor = 0d;
            foreach (Interval interval in merged)
            {
                if (interval.Minimum > cursor + GeometryEpsilon)
                {
                    BoundarySegment segment = Segment(sourceSurfaceId, sourceRegionId, start, end, top, cursor, interval.Minimum);
                    if (segment.Length >= MinimumBoundaryLength) yield return segment;
                }
                cursor = Math.Max(cursor, interval.Maximum);
            }

            if (cursor < 1d - GeometryEpsilon)
            {
                BoundarySegment segment = Segment(sourceSurfaceId, sourceRegionId, start, end, top, cursor, 1d);
                if (segment.Length >= MinimumBoundaryLength) yield return segment;
            }
        }

        private static BoundarySegment Segment(
            string surfaceId,
            string regionId,
            DungeonPoint2V2 start,
            DungeonPoint2V2 end,
            double top,
            double from,
            double to)
        {
            return new BoundarySegment(
                surfaceId,
                regionId,
                Lerp(start, end, from),
                Lerp(start, end, to),
                top);
        }

        private static IEnumerable<Interval> MergeIntervals(IEnumerable<Interval> intervals)
        {
            Interval[] ordered = intervals
                .Select(value => new Interval(Math.Max(0d, value.Minimum), Math.Min(1d, value.Maximum)))
                .Where(value => value.Maximum > value.Minimum + GeometryEpsilon)
                .OrderBy(value => value.Minimum)
                .ThenBy(value => value.Maximum)
                .ToArray();
            if (ordered.Length == 0) yield break;

            double minimum = ordered[0].Minimum;
            double maximum = ordered[0].Maximum;
            for (int index = 1; index < ordered.Length; index += 1)
            {
                if (ordered[index].Minimum <= maximum + GeometryEpsilon)
                {
                    maximum = Math.Max(maximum, ordered[index].Maximum);
                    continue;
                }

                yield return new Interval(minimum, maximum);
                minimum = ordered[index].Minimum;
                maximum = ordered[index].Maximum;
            }
            yield return new Interval(minimum, maximum);
        }

        private static bool TryClipSegmentToConvex(
            DungeonPoint2V2 start,
            DungeonPoint2V2 end,
            IReadOnlyList<DungeonPoint2V2> polygon,
            out Interval interval)
        {
            double winding = Math.Sign(SignedAreaTwice(polygon));
            double minimum = 0d;
            double maximum = 1d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                double edgeX = b.X - a.X;
                double edgeZ = b.Z - a.Z;
                double startSide = winding * (edgeX * (start.Z - a.Z) - edgeZ * (start.X - a.X));
                double endSide = winding * (edgeX * (end.Z - a.Z) - edgeZ * (end.X - a.X));
                double delta = endSide - startSide;
                if (Math.Abs(delta) <= GeometryEpsilon)
                {
                    if (startSide < -GeometryEpsilon)
                    {
                        interval = default;
                        return false;
                    }
                    continue;
                }

                double crossing = -startSide / delta;
                if (delta > 0d) minimum = Math.Max(minimum, crossing);
                else maximum = Math.Min(maximum, crossing);
                if (minimum > maximum + GeometryEpsilon)
                {
                    interval = default;
                    return false;
                }
            }

            interval = new Interval(minimum, maximum);
            return maximum >= minimum - GeometryEpsilon;
        }

        private static void ValidateElectricCrossingGeometry(
            DungeonPlanV2 plan,
            ICollection<IndustrialFactoryV2ValidationIssue> errors)
        {
            var electricControllerIds = new HashSet<string>(
                plan.EnvironmentControllers
                    .Where(value => value.Kind == DungeonEnvironmentControllerKindV2.ElectricCycle)
                    .Select(value => value.Id),
                StringComparer.Ordinal);
            double maximumUnsafeDistance = ElectricHazardSchedulerV2.RequiredCrossingLimitSeconds
                * TraversalProfilesV2.Dry.HorizontalSpeedCap;

            foreach (DungeonSurfacePlanV2 hazard in plan.Surfaces)
            {
                if (hazard.Kind != DungeonSurfaceKindV2.Hazard
                    || hazard.ControllerId == null
                    || !electricControllerIds.Contains(hazard.ControllerId))
                {
                    continue;
                }

                ProjectionAxis crossingAxis = FindMinimumWidthAxis(hazard.Volume.HorizontalVertices);
                Project(hazard.Volume.HorizontalVertices, crossingAxis, out double hazardMinimum, out double hazardMaximum);
                var safeIntervals = new List<ScalarInterval>();
                foreach (DungeonSurfacePlanV2 safe in plan.Surfaces)
                {
                    if (safe.Kind == DungeonSurfaceKindV2.Hazard
                        || !safe.IsStructural
                        || !safe.IsWalkable
                        || !IsAlways(safe.ActivePredicate)
                        || safe.Volume.MaximumY + GeometryEpsilon < hazard.Volume.MaximumY
                        || !PrismsOverlapProjection(hazard.Volume, safe.Volume)
                        || MinimumConvexWidth(safe.Volume.HorizontalVertices) + GeometryEpsilon < SafeIslandErosion * 2d)
                    {
                        continue;
                    }

                    Project(safe.Volume.HorizontalVertices, crossingAxis, out double safeMinimum, out double safeMaximum);
                    safeMinimum = Math.Max(hazardMinimum, safeMinimum + SafeIslandErosion);
                    safeMaximum = Math.Min(hazardMaximum, safeMaximum - SafeIslandErosion);
                    if (safeMaximum > safeMinimum + GeometryEpsilon)
                    {
                        safeIntervals.Add(new ScalarInterval(safeMinimum, safeMaximum));
                    }
                }

                double largestUnsafeSpan = LargestGap(hazardMinimum, hazardMaximum, safeIntervals);
                if (largestUnsafeSpan <= maximumUnsafeDistance + GeometryEpsilon) continue;

                Add(
                    errors,
                    "ELECTRIC_CROSSING_EXCEEDS_SAFE_WINDOW",
                    "/surfaces/" + hazard.Id,
                    "Geometry requires " + (largestUnsafeSpan / TraversalProfilesV2.Dry.HorizontalSpeedCap).ToString("0.###")
                        + " seconds of uninterrupted movement, exceeding the 1.9-second certified electric crossing window without a capsule-safe waiting island.");
            }
        }

        private static double LargestGap(
            double minimum,
            double maximum,
            IEnumerable<ScalarInterval> safeIntervals)
        {
            ScalarInterval[] ordered = safeIntervals
                .OrderBy(value => value.Minimum)
                .ThenBy(value => value.Maximum)
                .ToArray();
            double cursor = minimum;
            double largest = 0d;
            foreach (ScalarInterval safe in ordered)
            {
                if (safe.Maximum <= cursor + GeometryEpsilon) continue;
                if (safe.Minimum > cursor) largest = Math.Max(largest, safe.Minimum - cursor);
                cursor = Math.Max(cursor, safe.Maximum);
            }
            return Math.Max(largest, maximum - cursor);
        }

        private static ProjectionAxis FindMinimumWidthAxis(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            ProjectionAxis best = default;
            double bestWidth = double.PositiveInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                double edgeX = b.X - a.X;
                double edgeZ = b.Z - a.Z;
                double length = Math.Sqrt(edgeX * edgeX + edgeZ * edgeZ);
                if (length <= GeometryEpsilon) continue;
                var axis = new ProjectionAxis(-edgeZ / length, edgeX / length);
                Project(polygon, axis, out double minimum, out double maximum);
                double width = maximum - minimum;
                if (width < bestWidth)
                {
                    bestWidth = width;
                    best = axis;
                }
            }
            return best;
        }

        private static double MinimumConvexWidth(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            ProjectionAxis axis = FindMinimumWidthAxis(polygon);
            Project(polygon, axis, out double minimum, out double maximum);
            return maximum - minimum;
        }

        private static void Project(
            IReadOnlyList<DungeonPoint2V2> polygon,
            ProjectionAxis axis,
            out double minimum,
            out double maximum)
        {
            minimum = double.PositiveInfinity;
            maximum = double.NegativeInfinity;
            foreach (DungeonPoint2V2 point in polygon)
            {
                double projection = point.X * axis.X + point.Z * axis.Z;
                minimum = Math.Min(minimum, projection);
                maximum = Math.Max(maximum, projection);
            }
        }

        private static bool PrismsOverlapProjection(DungeonConvexPrismV2 a, DungeonConvexPrismV2 b)
        {
            return PolygonsOverlap(a.HorizontalVertices, b.HorizontalVertices)
                && a.MinimumY <= b.MaximumY + GeometryEpsilon
                && b.MinimumY <= a.MaximumY + GeometryEpsilon;
        }

        private static bool PolygonsOverlap(
            IReadOnlyList<DungeonPoint2V2> a,
            IReadOnlyList<DungeonPoint2V2> b)
        {
            foreach (IReadOnlyList<DungeonPoint2V2> polygon in new[] { a, b })
            {
                for (int index = 0; index < polygon.Count; index += 1)
                {
                    DungeonPoint2V2 p = polygon[index];
                    DungeonPoint2V2 q = polygon[(index + 1) % polygon.Count];
                    double dx = q.X - p.X;
                    double dz = q.Z - p.Z;
                    double length = Math.Sqrt(dx * dx + dz * dz);
                    if (length <= GeometryEpsilon) continue;
                    var axis = new ProjectionAxis(-dz / length, dx / length);
                    Project(a, axis, out double aMin, out double aMax);
                    Project(b, axis, out double bMin, out double bMax);
                    if (aMax < bMin - GeometryEpsilon || bMax < aMin - GeometryEpsilon) return false;
                }
            }
            return true;
        }

        private static bool PointInsideConvex(
            DungeonPoint2V2 point,
            IReadOnlyList<DungeonPoint2V2> polygon)
        {
            double winding = Math.Sign(SignedAreaTwice(polygon));
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                double cross = (b.X - a.X) * (point.Z - a.Z) - (b.Z - a.Z) * (point.X - a.X);
                if (cross * winding < -GeometryEpsilon) return false;
            }
            return true;
        }

        private static double SignedAreaTwice(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            double area = 0d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                area += a.X * b.Z - b.X * a.Z;
            }
            return area;
        }

        private static bool IsAlways(DungeonAccessPredicateV2 predicate)
        {
            return predicate.Clauses.Count == 1 && predicate.Clauses[0].Conditions.Count == 0;
        }

        private static double DistanceToBoundsXZ(double x, double z, DungeonBounds3 bounds)
        {
            double dx = x < bounds.Minimum.X
                ? bounds.Minimum.X - x
                : x > bounds.Maximum.X ? x - bounds.Maximum.X : 0d;
            double dz = z < bounds.Minimum.Z
                ? bounds.Minimum.Z - z
                : z > bounds.Maximum.Z ? z - bounds.Maximum.Z : 0d;
            return Math.Sqrt(dx * dx + dz * dz);
        }

        private static DungeonPoint2V2 Lerp(DungeonPoint2V2 a, DungeonPoint2V2 b, double t)
        {
            return new DungeonPoint2V2(a.X + (b.X - a.X) * t, a.Z + (b.Z - a.Z) * t);
        }

        private static string Format(DungeonPoint2V2 point)
        {
            return "(" + point.X.ToString("0.###") + ", " + point.Z.ToString("0.###") + ")";
        }

        private static void Add(
            ICollection<IndustrialFactoryV2ValidationIssue> errors,
            string code,
            string path,
            string message)
        {
            errors.Add(new IndustrialFactoryV2ValidationIssue(code, path, message));
        }

        private sealed class PredicatePath
        {
            public PredicatePath(string path, DungeonAccessPredicateV2 predicate)
            {
                Path = path;
                Predicate = predicate;
            }

            public string Path { get; }
            public DungeonAccessPredicateV2 Predicate { get; }
        }

        private readonly struct Interval
        {
            public Interval(double minimum, double maximum)
            {
                Minimum = minimum;
                Maximum = maximum;
            }

            public double Minimum { get; }
            public double Maximum { get; }
        }

        private readonly struct ScalarInterval
        {
            public ScalarInterval(double minimum, double maximum)
            {
                Minimum = minimum;
                Maximum = maximum;
            }

            public double Minimum { get; }
            public double Maximum { get; }
        }

        private readonly struct ProjectionAxis
        {
            public ProjectionAxis(double x, double z)
            {
                X = x;
                Z = z;
            }

            public double X { get; }
            public double Z { get; }
        }

        private sealed class BoundarySegment
        {
            public BoundarySegment(
                string sourceSurfaceId,
                string sourceRegionId,
                DungeonPoint2V2 start,
                DungeonPoint2V2 end,
                double surfaceTopY)
            {
                SourceSurfaceId = sourceSurfaceId;
                SourceRegionId = sourceRegionId;
                Start = start;
                End = end;
                SurfaceTopY = surfaceTopY;
            }

            public string SourceSurfaceId { get; }
            public string SourceRegionId { get; }
            public DungeonPoint2V2 Start { get; }
            public DungeonPoint2V2 End { get; }
            public double SurfaceTopY { get; }
            public double Length
            {
                get
                {
                    double dx = End.X - Start.X;
                    double dz = End.Z - Start.Z;
                    return Math.Sqrt(dx * dx + dz * dz);
                }
            }
        }
    }
}
