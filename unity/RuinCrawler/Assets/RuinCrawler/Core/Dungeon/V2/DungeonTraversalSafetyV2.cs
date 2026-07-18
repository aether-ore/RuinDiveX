using System;
using System.Collections.Generic;
using System.Linq;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Frozen player-reaction contract used when certifying fall catchments. The
    /// values are deliberately engine independent so an authored volume cannot
    /// silently become unsafe when the Unity reaction adapter is changed.
    /// </summary>
    public sealed class DungeonReactionEnvelopeV2
    {
        public DungeonReactionEnvelopeV2(
            string id,
            double strengthMultiplier,
            double maximumHorizontalSpeed,
            double upwardVelocity,
            double riseGravity,
            double fallMultiplier)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Reaction envelope ID is required.", nameof(id));
            TraversalV2Guard.RequirePositive(strengthMultiplier, nameof(strengthMultiplier));
            TraversalV2Guard.RequirePositive(maximumHorizontalSpeed, nameof(maximumHorizontalSpeed));
            TraversalV2Guard.RequireNonNegative(upwardVelocity, nameof(upwardVelocity));
            TraversalV2Guard.RequirePositive(riseGravity, nameof(riseGravity));
            TraversalV2Guard.RequirePositive(fallMultiplier, nameof(fallMultiplier));

            Id = id;
            StrengthMultiplier = strengthMultiplier;
            MaximumHorizontalSpeed = maximumHorizontalSpeed;
            UpwardVelocity = upwardVelocity;
            RiseGravity = riseGravity;
            FallMultiplier = fallMultiplier;
        }

        public string Id { get; }
        public double StrengthMultiplier { get; }
        public double MaximumHorizontalSpeed { get; }
        public double UpwardVelocity { get; }
        public double RiseGravity { get; }
        public double FallMultiplier { get; }
        public double FallGravity => RiseGravity * FallMultiplier;
        public double ApexTime => UpwardVelocity / RiseGravity;
        public double MaximumRiseHeight => UpwardVelocity * UpwardVelocity / (2d * RiseGravity);
    }

    public static class DungeonReactionEnvelopesV2
    {
        public static DungeonReactionEnvelopeV2 PlayerKnockback { get; } = new DungeonReactionEnvelopeV2(
            IndustrialFactoryV2Ruleset.ReactionEnvelopeId,
            strengthMultiplier: 1.5d,
            maximumHorizontalSpeed: 8.1d,
            upwardVelocity: 6.37d,
            riseGravity: 12.5d,
            fallMultiplier: 1.08d);

        public static bool TryResolve(string id, out DungeonReactionEnvelopeV2 envelope)
        {
            if (string.Equals(id, PlayerKnockback.Id, StringComparison.Ordinal))
            {
                envelope = PlayerKnockback;
                return true;
            }

            envelope = null;
            return false;
        }
    }

    /// <summary>Hard traversal margins reserved for input and collision variance.</summary>
    public static class DungeonTraversalUtilizationPolicyV2
    {
        public const double RequiredHorizontalRatio = 0.85d;
        public const double RequiredVerticalRatio = 0.90d;
        public const double OptionalHorizontalRatio = 0.95d;
        public const double OptionalVerticalRatio = 0.95d;
        public const double SafeDropDistance = 6d;
        public const double MaximumGroundedDodgeSpeed = 8.5d;
        public const double MaximumGroundedDodgeDuration = 0.22d;
        public const double MovingPlatformAmplitude = 2.5d;
        public const double MovingPlatformPeriod = 4d;

        public static double MaximumGroundedDodgeDistance =>
            MaximumGroundedDodgeSpeed * MaximumGroundedDodgeDuration;

        public static double MaximumMovingPlatformTangentSpeed =>
            2d * Math.PI * MovingPlatformAmplitude / MovingPlatformPeriod;
    }

    public sealed class DungeonTraversalEdgeGeometryV2
    {
        internal DungeonTraversalEdgeGeometryV2(
            DungeonTraversalEdgePlanV2 edge,
            DungeonSurfacePlanV2 sourceSupport,
            DungeonSurfacePlanV2 targetSupport,
            TraversalProfileV2 profile,
            bool optional,
            double horizontalGap,
            double verticalRise,
            double verticalDrop)
        {
            Edge = edge;
            SourceSupport = sourceSupport;
            TargetSupport = targetSupport;
            Profile = profile;
            IsOptional = optional;
            HorizontalGap = horizontalGap;
            VerticalRise = verticalRise;
            VerticalDrop = verticalDrop;
        }

        public DungeonTraversalEdgePlanV2 Edge { get; }
        public DungeonSurfacePlanV2 SourceSupport { get; }
        public DungeonSurfacePlanV2 TargetSupport { get; }
        public TraversalProfileV2 Profile { get; }
        public bool IsOptional { get; }
        public double HorizontalGap { get; }
        public double VerticalRise { get; }
        public double VerticalDrop { get; }
        public double MaximumHorizontalJumpDistance => Profile.HorizontalSpeedCap * Profile.SameHeightAirTime;
    }

    /// <summary>
    /// Measures generated support geometry, rather than authoring anchors. This
    /// prevents a cosmetically offset anchor from weakening a traversal gate.
    /// </summary>
    public static class DungeonTraversalGeometryV2
    {
        public static bool TryMeasure(
            DungeonPlanV2 plan,
            DungeonTraversalEdgePlanV2 edge,
            out DungeonTraversalEdgeGeometryV2 geometry)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            if (edge == null) throw new ArgumentNullException(nameof(edge));

            DungeonAnchorPlanV2 fromAnchor = plan.Anchors.FirstOrDefault(value =>
                string.Equals(value.Id, edge.FromAnchorId, StringComparison.Ordinal));
            DungeonAnchorPlanV2 toAnchor = plan.Anchors.FirstOrDefault(value =>
                string.Equals(value.Id, edge.ToAnchorId, StringComparison.Ordinal));
            if (fromAnchor == null || toAnchor == null)
            {
                geometry = null;
                return false;
            }

            DungeonSurfacePlanV2 source = FindSupport(plan, edge.FromRegionId, fromAnchor.Position);
            DungeonSurfacePlanV2 target = FindSupport(plan, edge.ToRegionId, toAnchor.Position);
            if (source == null || target == null)
            {
                geometry = null;
                return false;
            }

            double deltaY = target.Volume.MaximumY - source.Volume.MaximumY;
            bool referenced = false;
            bool optional = true;
            foreach (DungeonExplorationRoutePlanV2 route in plan.Routes)
            {
                if (!Contains(route.OrderedTraversalEdgeIds, edge.Id)) continue;
                referenced = true;
                optional &= route.Role == DungeonRouteRoleV2.OptionalBranch;
            }

            optional &= referenced;
            TraversalProfileV2 profile = plan.FluidZones.Any(value =>
                string.Equals(value.RegionId, edge.FromRegionId, StringComparison.Ordinal))
                ? TraversalProfilesV2.Flooded
                : TraversalProfilesV2.Dry;
            geometry = new DungeonTraversalEdgeGeometryV2(
                edge,
                source,
                target,
                profile,
                optional,
                PolygonDistance(source.Volume.HorizontalVertices, target.Volume.HorizontalVertices),
                Math.Max(0d, deltaY),
                Math.Max(0d, -deltaY));
            return true;
        }

        private static DungeonSurfacePlanV2 FindSupport(
            DungeonPlanV2 plan,
            string regionId,
            DungeonPoint3 anchor)
        {
            return plan.Surfaces
                .Where(value => string.Equals(value.RegionId, regionId, StringComparison.Ordinal)
                    && value.IsWalkable
                    && value.Kind != DungeonSurfaceKindV2.Hazard)
                .OrderBy(value => Math.Abs(value.Volume.MaximumY - anchor.Y))
                .ThenBy(value => PointPolygonDistance(anchor.X, anchor.Z, value.Volume.HorizontalVertices))
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .FirstOrDefault();
        }

        private static bool Contains(IReadOnlyList<string> values, string target)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.Equals(values[index], target, StringComparison.Ordinal)) return true;
            }

            return false;
        }

        private static double PolygonDistance(
            IReadOnlyList<DungeonPoint2V2> a,
            IReadOnlyList<DungeonPoint2V2> b)
        {
            if (a.Any(point => DungeonProgressionSolverV2.PointInsideConvex(point.X, point.Z, b, 0d))
                || b.Any(point => DungeonProgressionSolverV2.PointInsideConvex(point.X, point.Z, a, 0d)))
            {
                return 0d;
            }

            double minimum = double.PositiveInfinity;
            for (int ai = 0; ai < a.Count; ai += 1)
            {
                DungeonPoint2V2 aa = a[ai];
                DungeonPoint2V2 ab = a[(ai + 1) % a.Count];
                for (int bi = 0; bi < b.Count; bi += 1)
                {
                    DungeonPoint2V2 ba = b[bi];
                    DungeonPoint2V2 bb = b[(bi + 1) % b.Count];
                    if (SegmentsIntersect(aa, ab, ba, bb)) return 0d;
                    minimum = Math.Min(minimum, PointSegmentDistance(aa.X, aa.Z, ba, bb));
                    minimum = Math.Min(minimum, PointSegmentDistance(ab.X, ab.Z, ba, bb));
                    minimum = Math.Min(minimum, PointSegmentDistance(ba.X, ba.Z, aa, ab));
                    minimum = Math.Min(minimum, PointSegmentDistance(bb.X, bb.Z, aa, ab));
                }
            }

            return minimum;
        }

        private static double PointPolygonDistance(
            double x,
            double z,
            IReadOnlyList<DungeonPoint2V2> polygon)
        {
            if (DungeonProgressionSolverV2.PointInsideConvex(x, z, polygon, 0d)) return 0d;
            double minimum = double.PositiveInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                minimum = Math.Min(
                    minimum,
                    PointSegmentDistance(x, z, polygon[index], polygon[(index + 1) % polygon.Count]));
            }

            return minimum;
        }

        private static double PointSegmentDistance(
            double x,
            double z,
            DungeonPoint2V2 a,
            DungeonPoint2V2 b)
        {
            double dx = b.X - a.X;
            double dz = b.Z - a.Z;
            double denominator = dx * dx + dz * dz;
            if (denominator <= 1e-18d)
            {
                dx = x - a.X;
                dz = z - a.Z;
                return Math.Sqrt(dx * dx + dz * dz);
            }

            double t = ((x - a.X) * dx + (z - a.Z) * dz) / denominator;
            t = Math.Max(0d, Math.Min(1d, t));
            double offsetX = x - (a.X + t * dx);
            double offsetZ = z - (a.Z + t * dz);
            return Math.Sqrt(offsetX * offsetX + offsetZ * offsetZ);
        }

        private static bool SegmentsIntersect(
            DungeonPoint2V2 a,
            DungeonPoint2V2 b,
            DungeonPoint2V2 c,
            DungeonPoint2V2 d)
        {
            const double epsilon = 1e-12d;
            if (Math.Max(a.X, b.X) < Math.Min(c.X, d.X) - epsilon
                || Math.Max(c.X, d.X) < Math.Min(a.X, b.X) - epsilon
                || Math.Max(a.Z, b.Z) < Math.Min(c.Z, d.Z) - epsilon
                || Math.Max(c.Z, d.Z) < Math.Min(a.Z, b.Z) - epsilon)
            {
                return false;
            }

            double abC = Cross(a, b, c);
            double abD = Cross(a, b, d);
            double cdA = Cross(c, d, a);
            double cdB = Cross(c, d, b);
            return abC * abD <= epsilon && cdA * cdB <= epsilon;
        }

        private static double Cross(DungeonPoint2V2 a, DungeonPoint2V2 b, DungeonPoint2V2 point)
        {
            return (b.X - a.X) * (point.Z - a.Z) - (b.Z - a.Z) * (point.X - a.X);
        }
    }

    public sealed class DungeonTraversalEnvelopeValidatorV2
    {
        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                if (edge.Kind != DungeonConnectorKindV2.Jump
                    && edge.Kind != DungeonConnectorKindV2.Drop) continue;

                if (!DungeonTraversalGeometryV2.TryMeasure(plan, edge, out DungeonTraversalEdgeGeometryV2 geometry))
                {
                    Add(errors, "TRAVERSAL_SUPPORT_GEOMETRY_MISSING", edge.Id,
                        "Traversal support geometry could not be resolved from the generated surfaces.");
                    continue;
                }

                if (edge.Kind == DungeonConnectorKindV2.Drop)
                {
                    if (geometry.VerticalDrop > DungeonTraversalUtilizationPolicyV2.SafeDropDistance + 1e-9d)
                    {
                        Add(errors, "SAFE_DROP_ENVELOPE_EXCEEDED", edge.Id,
                            "Generated support geometry exceeds the certified 6.0-unit safe drop.");
                    }

                    continue;
                }

                double horizontalRatio = geometry.IsOptional
                    ? DungeonTraversalUtilizationPolicyV2.OptionalHorizontalRatio
                    : DungeonTraversalUtilizationPolicyV2.RequiredHorizontalRatio;
                double verticalRatio = geometry.IsOptional
                    ? DungeonTraversalUtilizationPolicyV2.OptionalVerticalRatio
                    : DungeonTraversalUtilizationPolicyV2.RequiredVerticalRatio;
                if (geometry.HorizontalGap > geometry.MaximumHorizontalJumpDistance * horizontalRatio + 1e-9d)
                {
                    Add(
                        errors,
                        geometry.IsOptional
                            ? "OPTIONAL_JUMP_HORIZONTAL_MARGIN_EXCEEDED"
                            : "REQUIRED_JUMP_HORIZONTAL_MARGIN_EXCEEDED",
                        edge.Id,
                        "Generated horizontal gap consumes more than the certified jump margin.");
                }

                if (geometry.VerticalRise > geometry.Profile.MaximumLedgeCatchRise * verticalRatio + 1e-9d)
                {
                    Add(
                        errors,
                        geometry.IsOptional
                            ? "OPTIONAL_JUMP_VERTICAL_MARGIN_EXCEEDED"
                            : "REQUIRED_JUMP_VERTICAL_MARGIN_EXCEEDED",
                        edge.Id,
                        "Generated vertical rise consumes more than the certified jump margin.");
                }
            }

            return Array.AsReadOnly(errors.ToArray());
        }

        private static void Add(
            ICollection<IndustrialFactoryV2ValidationIssue> errors,
            string code,
            string edgeId,
            string message)
        {
            errors.Add(new IndustrialFactoryV2ValidationIssue(
                code,
                "/traversalEdges/" + edgeId,
                message));
        }
    }

    public enum DungeonTraversalTrajectoryKindV2
    {
        WalkOff,
        Jump,
        MaximumGroundedDodge,
        Crumble,
        MovingPlatformFailure,
        MaximumKnockback
    }

    public readonly struct DungeonTraversalTrajectorySampleV2
    {
        public DungeonTraversalTrajectorySampleV2(
            double time,
            double horizontalDisplacement,
            double verticalPosition,
            BallisticPhaseV2 phase)
        {
            Time = time;
            HorizontalDisplacement = horizontalDisplacement;
            VerticalPosition = verticalPosition;
            Phase = phase;
        }

        public double Time { get; }
        public double HorizontalDisplacement { get; }
        public double VerticalPosition { get; }
        public BallisticPhaseV2 Phase { get; }
    }

    public sealed class DungeonTraversalTrajectoryV2
    {
        internal DungeonTraversalTrajectoryV2(
            DungeonTraversalTrajectoryKindV2 kind,
            int simulationFrequency,
            double sourceY,
            double landingY,
            double duration,
            double maximumVerticalPosition,
            double finalHorizontalDisplacement,
            IEnumerable<DungeonTraversalTrajectorySampleV2> samples)
        {
            Kind = kind;
            SimulationFrequency = simulationFrequency;
            SourceY = sourceY;
            LandingY = landingY;
            Duration = duration;
            MaximumVerticalPosition = maximumVerticalPosition;
            FinalHorizontalDisplacement = finalHorizontalDisplacement;
            Samples = Array.AsReadOnly((samples ?? Array.Empty<DungeonTraversalTrajectorySampleV2>()).ToArray());
        }

        public DungeonTraversalTrajectoryKindV2 Kind { get; }
        public int SimulationFrequency { get; }
        public double SourceY { get; }
        public double LandingY { get; }
        public double Duration { get; }
        public double MaximumVerticalPosition { get; }
        public double MinimumVerticalPosition => Math.Min(SourceY, LandingY);
        public double FinalHorizontalDisplacement { get; }
        public IReadOnlyList<DungeonTraversalTrajectorySampleV2> Samples { get; }

        public bool ReachesOrCrossesFallback(double fallbackY)
        {
            return Samples.Any(sample => sample.VerticalPosition <= fallbackY + 1e-9d);
        }
    }

    /// <summary>
    /// Analytic corpus sampled at fixed render rates. Landing and apex samples are
    /// always inserted exactly, making endpoint verdicts frequency independent.
    /// </summary>
    public static class DungeonTraversalTrajectoryCorpusV2
    {
        private static readonly int[] Frequencies = { 30, 60, 120 };

        public static IReadOnlyList<DungeonTraversalTrajectoryV2> CreateAll(
            double sourceY,
            double landingY,
            TraversalProfileV2 profile = null)
        {
            var trajectories = new List<DungeonTraversalTrajectoryV2>(18);
            foreach (DungeonTraversalTrajectoryKindV2 kind in Enum.GetValues(typeof(DungeonTraversalTrajectoryKindV2)))
            foreach (int frequency in Frequencies)
            {
                trajectories.Add(Create(kind, frequency, sourceY, landingY, profile));
            }

            return Array.AsReadOnly(trajectories.ToArray());
        }

        public static DungeonTraversalTrajectoryV2 Create(
            DungeonTraversalTrajectoryKindV2 kind,
            int simulationFrequency,
            double sourceY,
            double landingY,
            TraversalProfileV2 profile = null)
        {
            if (simulationFrequency != 30 && simulationFrequency != 60 && simulationFrequency != 120)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(simulationFrequency),
                    "The certified corpus is sampled only at 30, 60, or 120 Hz.");
            }

            TraversalV2Guard.RequireFinite(sourceY, nameof(sourceY));
            TraversalV2Guard.RequireFinite(landingY, nameof(landingY));
            if (landingY > sourceY + 1e-9d)
            {
                throw new ArgumentOutOfRangeException(nameof(landingY), "Fall-corpus landings may not be above the source.");
            }

            profile = profile ?? TraversalProfilesV2.Dry;
            double initialVelocity;
            double riseGravity;
            double fallGravity;
            switch (kind)
            {
                case DungeonTraversalTrajectoryKindV2.Jump:
                    initialVelocity = profile.TakeoffVelocity;
                    riseGravity = profile.RiseGravity;
                    fallGravity = profile.FallGravity;
                    break;
                case DungeonTraversalTrajectoryKindV2.MaximumKnockback:
                    DungeonReactionEnvelopeV2 reaction = DungeonReactionEnvelopesV2.PlayerKnockback;
                    initialVelocity = reaction.UpwardVelocity;
                    riseGravity = reaction.RiseGravity;
                    fallGravity = reaction.FallGravity;
                    break;
                default:
                    initialVelocity = 0d;
                    riseGravity = profile.RiseGravity;
                    fallGravity = profile.FallGravity;
                    break;
            }

            double apexTime = initialVelocity > 0d ? initialVelocity / riseGravity : 0d;
            double apexY = sourceY + initialVelocity * initialVelocity / (2d * riseGravity);
            double duration = apexTime + Math.Sqrt(Math.Max(0d, 2d * (apexY - landingY) / fallGravity));
            var samples = new List<DungeonTraversalTrajectorySampleV2>();
            int regularSamples = (int)Math.Floor(duration * simulationFrequency + 1e-12d);
            for (int index = 0; index <= regularSamples; index += 1)
            {
                AddSample(samples, kind, index / (double)simulationFrequency, sourceY, initialVelocity,
                    riseGravity, fallGravity, apexTime, apexY, duration, profile);
            }

            if (apexTime > 0d && apexTime < duration)
            {
                AddSample(samples, kind, apexTime, sourceY, initialVelocity,
                    riseGravity, fallGravity, apexTime, apexY, duration, profile);
            }

            AddSample(samples, kind, duration, sourceY, initialVelocity,
                riseGravity, fallGravity, apexTime, apexY, duration, profile);
            DungeonTraversalTrajectorySampleV2[] ordered = samples
                .GroupBy(value => value.Time)
                .Select(group => group.First())
                .OrderBy(value => value.Time)
                .ToArray();
            ordered[ordered.Length - 1] = new DungeonTraversalTrajectorySampleV2(
                duration,
                HorizontalDisplacement(kind, duration, duration, profile),
                landingY,
                BallisticPhaseV2.Falling);
            return new DungeonTraversalTrajectoryV2(
                kind,
                simulationFrequency,
                sourceY,
                landingY,
                duration,
                apexY,
                ordered[ordered.Length - 1].HorizontalDisplacement,
                ordered);
        }

        public static DungeonFallExposureCauseV2 CauseFor(DungeonTraversalTrajectoryKindV2 kind)
        {
            switch (kind)
            {
                case DungeonTraversalTrajectoryKindV2.WalkOff: return DungeonFallExposureCauseV2.Walk;
                case DungeonTraversalTrajectoryKindV2.Jump: return DungeonFallExposureCauseV2.Jump;
                case DungeonTraversalTrajectoryKindV2.MaximumGroundedDodge: return DungeonFallExposureCauseV2.Dodge;
                case DungeonTraversalTrajectoryKindV2.Crumble: return DungeonFallExposureCauseV2.Crumble;
                case DungeonTraversalTrajectoryKindV2.MovingPlatformFailure:
                    return DungeonFallExposureCauseV2.MovingSurfaceFailure;
                case DungeonTraversalTrajectoryKindV2.MaximumKnockback: return DungeonFallExposureCauseV2.Knockback;
                default: throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown trajectory kind.");
            }
        }

        private static void AddSample(
            ICollection<DungeonTraversalTrajectorySampleV2> samples,
            DungeonTraversalTrajectoryKindV2 kind,
            double time,
            double sourceY,
            double initialVelocity,
            double riseGravity,
            double fallGravity,
            double apexTime,
            double apexY,
            double duration,
            TraversalProfileV2 profile)
        {
            bool rising = initialVelocity > 0d && time < apexTime - 1e-12d;
            double y = rising
                ? sourceY + initialVelocity * time - 0.5d * riseGravity * time * time
                : apexY - 0.5d * fallGravity * (time - apexTime) * (time - apexTime);
            samples.Add(new DungeonTraversalTrajectorySampleV2(
                time,
                HorizontalDisplacement(kind, time, duration, profile),
                y,
                rising ? BallisticPhaseV2.Rising : BallisticPhaseV2.Falling));
        }

        private static double HorizontalDisplacement(
            DungeonTraversalTrajectoryKindV2 kind,
            double time,
            double duration,
            TraversalProfileV2 profile)
        {
            switch (kind)
            {
                case DungeonTraversalTrajectoryKindV2.Crumble:
                    return 0d;
                case DungeonTraversalTrajectoryKindV2.MaximumGroundedDodge:
                    double dodgeTime = Math.Min(time, DungeonTraversalUtilizationPolicyV2.MaximumGroundedDodgeDuration);
                    return DungeonTraversalUtilizationPolicyV2.MaximumGroundedDodgeSpeed * dodgeTime
                        + profile.HorizontalSpeedCap * Math.Max(0d, time - dodgeTime);
                case DungeonTraversalTrajectoryKindV2.MovingPlatformFailure:
                    return DungeonTraversalUtilizationPolicyV2.MaximumMovingPlatformTangentSpeed * time;
                case DungeonTraversalTrajectoryKindV2.MaximumKnockback:
                    return DungeonReactionEnvelopesV2.PlayerKnockback.MaximumHorizontalSpeed * time;
                default:
                    return profile.HorizontalSpeedCap * time;
            }
        }
    }

    public sealed class DungeonTraversalCorpusValidatorV2
    {
        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> Validate(DungeonPlanV2 plan)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            var errors = new List<IndustrialFactoryV2ValidationIssue>();
            var catchments = plan.FallCatchments.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var surfaces = plan.Surfaces.ToDictionary(value => value.Id, StringComparer.Ordinal);
            double fallbackY = plan.Bounds.Minimum.Y - 8d;

            foreach (DungeonFallExposurePlanV2 exposure in plan.FallExposures)
            foreach (string catchmentId in exposure.RequiredCatchmentIds)
            {
                if (!catchments.TryGetValue(catchmentId, out DungeonFallCatchmentPlanV2 catchment)) continue;
                double landingY = catchment.SafeSurfaceIds
                    .Where(surfaces.ContainsKey)
                    .Select(id => surfaces[id].Volume.MaximumY)
                    .DefaultIfEmpty(catchment.Volume.MinimumY)
                    .Max();
                TraversalProfileV2 profile = plan.FluidZones.Any(value =>
                    string.Equals(value.RegionId, exposure.SourceRegionId, StringComparison.Ordinal))
                    ? TraversalProfilesV2.Flooded
                    : TraversalProfilesV2.Dry;

                foreach (DungeonTraversalTrajectoryKindV2 kind in Enum.GetValues(typeof(DungeonTraversalTrajectoryKindV2)))
                {
                    DungeonFallExposureCauseV2 cause = DungeonTraversalTrajectoryCorpusV2.CauseFor(kind);
                    if ((exposure.Causes & cause) == 0) continue;
                    foreach (int frequency in new[] { 30, 60, 120 })
                    {
                        DungeonTraversalTrajectoryV2 trajectory = DungeonTraversalTrajectoryCorpusV2.Create(
                            kind,
                            frequency,
                            exposure.SourceVolume.MaximumY,
                            landingY,
                            profile);
                        if (trajectory.ReachesOrCrossesFallback(fallbackY))
                        {
                            Add(errors, "TRAJECTORY_CORPUS_REACHES_FALLBACK", exposure.Id,
                                kind + " at " + frequency + " Hz reaches the diagnostic fallback before its safe landing.");
                        }

                        if (trajectory.MaximumVerticalPosition
                                > exposure.ConservativeFallVolume.MaximumY + 1e-9d
                            || trajectory.MinimumVerticalPosition
                                < exposure.ConservativeFallVolume.MinimumY - 1e-9d)
                        {
                            Add(errors, "TRAJECTORY_CORPUS_VERTICAL_VOLUME_ESCAPE", exposure.Id,
                                kind + " at " + frequency + " Hz leaves the certified vertical fall volume.");
                        }

                        if (!TryResolveCatchmentDirectedStart(
                            exposure.SourceVolume.HorizontalVertices,
                            catchment.Volume.HorizontalVertices,
                            trajectory.FinalHorizontalDisplacement,
                            out double startX,
                            out double startZ,
                            out double directionX,
                            out double directionZ))
                        {
                            Add(errors, "TRAJECTORY_CORPUS_HORIZONTAL_CATCHMENT_MISS", exposure.Id,
                                kind + " at " + frequency + " Hz has no certified source-to-catchment horizontal path.");
                            continue;
                        }

                        bool contained = trajectory.Samples.All(sample =>
                            DungeonProgressionSolverV2.PointInsideConvex(
                                startX + directionX * sample.HorizontalDisplacement,
                                startZ + directionZ * sample.HorizontalDisplacement,
                                exposure.ConservativeFallVolume.HorizontalVertices,
                                0d));
                        if (!contained)
                        {
                            Add(errors, "TRAJECTORY_CORPUS_HORIZONTAL_VOLUME_ESCAPE", exposure.Id,
                                kind + " at " + frequency + " Hz leaves the certified horizontal fall volume.");
                        }
                    }
                }
            }

            return Array.AsReadOnly(errors.ToArray());
        }

        private static bool TryResolveCatchmentDirectedStart(
            IReadOnlyList<DungeonPoint2V2> source,
            IReadOnlyList<DungeonPoint2V2> catchment,
            double displacement,
            out double startX,
            out double startZ,
            out double directionX,
            out double directionZ)
        {
            DungeonPoint2V2 sourceCenter = Center(source);
            DungeonPoint2V2 catchmentCenter = Center(catchment);
            directionX = catchmentCenter.X - sourceCenter.X;
            directionZ = catchmentCenter.Z - sourceCenter.Z;
            double length = Math.Sqrt(directionX * directionX + directionZ * directionZ);
            if (length <= 1e-12d)
            {
                directionX = 1d;
                directionZ = 0d;
            }
            else
            {
                directionX /= length;
                directionZ /= length;
            }

            if (!TryLineInterval(source, sourceCenter, directionX, directionZ, out double sourceMinimum, out double sourceMaximum)
                || !TryLineInterval(catchment, sourceCenter, directionX, directionZ, out double targetMinimum, out double targetMaximum))
            {
                startX = 0d;
                startZ = 0d;
                return false;
            }

            double minimumStart = Math.Max(sourceMinimum, targetMinimum - displacement);
            double maximumStart = Math.Min(sourceMaximum, targetMaximum - displacement);
            if (minimumStart > maximumStart + 1e-9d)
            {
                startX = 0d;
                startZ = 0d;
                return false;
            }

            double startOffset = (minimumStart + maximumStart) * 0.5d;
            startX = sourceCenter.X + directionX * startOffset;
            startZ = sourceCenter.Z + directionZ * startOffset;
            return true;
        }

        private static DungeonPoint2V2 Center(IReadOnlyList<DungeonPoint2V2> polygon)
        {
            double x = 0d;
            double z = 0d;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                x += polygon[index].X;
                z += polygon[index].Z;
            }

            return new DungeonPoint2V2(x / polygon.Count, z / polygon.Count);
        }

        private static bool TryLineInterval(
            IReadOnlyList<DungeonPoint2V2> polygon,
            DungeonPoint2V2 origin,
            double directionX,
            double directionZ,
            out double minimum,
            out double maximum)
        {
            minimum = double.PositiveInfinity;
            maximum = double.NegativeInfinity;
            for (int index = 0; index < polygon.Count; index += 1)
            {
                DungeonPoint2V2 a = polygon[index];
                DungeonPoint2V2 b = polygon[(index + 1) % polygon.Count];
                double edgeX = b.X - a.X;
                double edgeZ = b.Z - a.Z;
                double relativeX = a.X - origin.X;
                double relativeZ = a.Z - origin.Z;
                double denominator = Cross(directionX, directionZ, edgeX, edgeZ);
                if (Math.Abs(denominator) <= 1e-12d)
                {
                    if (Math.Abs(Cross(relativeX, relativeZ, directionX, directionZ)) > 1e-12d) continue;
                    Include(Project(a, origin, directionX, directionZ), ref minimum, ref maximum);
                    Include(Project(b, origin, directionX, directionZ), ref minimum, ref maximum);
                    continue;
                }

                double edgeParameter = Cross(relativeX, relativeZ, directionX, directionZ) / denominator;
                if (edgeParameter < -1e-9d || edgeParameter > 1d + 1e-9d) continue;
                double lineParameter = Cross(relativeX, relativeZ, edgeX, edgeZ) / denominator;
                Include(lineParameter, ref minimum, ref maximum);
            }

            return !double.IsInfinity(minimum) && !double.IsInfinity(maximum);
        }

        private static double Project(
            DungeonPoint2V2 point,
            DungeonPoint2V2 origin,
            double directionX,
            double directionZ)
        {
            return (point.X - origin.X) * directionX + (point.Z - origin.Z) * directionZ;
        }

        private static double Cross(double ax, double az, double bx, double bz)
        {
            return ax * bz - az * bx;
        }

        private static void Include(double value, ref double minimum, ref double maximum)
        {
            minimum = Math.Min(minimum, value);
            maximum = Math.Max(maximum, value);
        }

        private static void Add(
            ICollection<IndustrialFactoryV2ValidationIssue> errors,
            string code,
            string exposureId,
            string message)
        {
            errors.Add(new IndustrialFactoryV2ValidationIssue(
                code,
                "/fallCoverage/" + exposureId,
                message));
        }
    }
}
