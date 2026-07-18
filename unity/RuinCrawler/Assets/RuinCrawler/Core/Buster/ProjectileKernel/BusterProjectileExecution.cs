using System;
using System.Collections.Generic;
using System.Globalization;

namespace RuinCrawler.Core.Buster.ProjectileKernel
{
    /// <summary>
    /// Pure, stateful execution of one immutable compiled Buster shot. It performs no scene,
    /// physics, health, pooling, or reward mutations; adapters consume the ordered event stream.
    /// </summary>
    public sealed class BusterProjectileExecution
    {
        private readonly CompiledBusterPlan _plan;
        private readonly BusterProjectileExecutionRequest _request;
        private readonly BusterAction _rootAction;
        private readonly BusterAction _triggerAction;
        private readonly BusterAction _childAction;
        private readonly List<ProjectileState> _projectiles = new List<ProjectileState>();
        private readonly List<BusterProjectileEventRecord> _events =
            new List<BusterProjectileEventRecord>();
        private readonly BusterPacketBudget _packetBudget;
        private List<BusterProjectileEventRecord> _currentFrameEvents;
        private long _projectileCounter;
        private long _eventSequence;
        private double _elapsedSeconds;

        public BusterProjectileExecution(
            CompiledBusterPlan plan,
            BusterProjectileExecutionRequest request)
        {
            _plan = plan ?? throw new ArgumentNullException(nameof(plan));
            _request = request ?? throw new ArgumentNullException(nameof(request));
            _rootAction = FindAction(plan.Actions, "emit", "root")
                ?? throw new ArgumentException("The compiled plan has no root emission.", nameof(plan));
            _triggerAction = FindAction(plan.Actions, "trigger", null);
            _childAction = FindAction(plan.Actions, "emit", "child");
            WeaponKey = plan.WeaponKey;
            BuildId = plan.BuildId;
            BuildRevision = plan.BuildRevision;
            ExecutionId = request.ExecutionId;
            ReservationToken = request.ReservationToken;
            _packetBudget = CreatePacketBudget(plan, _rootAction, _childAction);
            SpawnAction(
                _rootAction,
                request.Origin,
                request.Direction,
                request.AimPoint,
                "root",
                request.LockedTargetId,
                0d);
        }

        public string ExecutionId { get; }
        public string ReservationToken { get; }
        public string WeaponKey { get; }
        public string BuildId { get; }
        public int BuildRevision { get; }
        public double ElapsedSeconds => _elapsedSeconds;
        public BusterPacketBudget PacketBudget => _packetBudget;
        public int ActiveProjectileCount
        {
            get
            {
                int count = 0;
                for (int index = 0; index < _projectiles.Count; index += 1)
                {
                    if (_projectiles[index].Alive)
                    {
                        count += 1;
                    }
                }

                return count;
            }
        }
        public bool Complete => ActiveProjectileCount == 0;

        public BusterProjectileAdvanceResult Advance(
            double elapsedSeconds,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets)
        {
            double elapsed = Math.Max(0d, FiniteOr(elapsedSeconds, 0d));
            double frameStart = _elapsedSeconds;
            if (elapsed <= 0d)
            {
                return new BusterProjectileAdvanceResult(
                    frameStart,
                    frameStart,
                    ActiveProjectileCount,
                    Complete,
                    Array.Empty<BusterProjectileEventRecord>());
            }

            IReadOnlyList<BusterProjectileTargetSnapshot> stableTargets = SortTargets(targets);
            _currentFrameEvents = new List<BusterProjectileEventRecord>();
            var activeAtFrameStart = new List<ProjectileState>();
            for (int index = 0; index < _projectiles.Count; index += 1)
            {
                if (_projectiles[index].Alive)
                {
                    activeAtFrameStart.Add(_projectiles[index]);
                }
            }

            activeAtFrameStart.Sort((left, right) =>
                string.CompareOrdinal(left.ProjectileId, right.ProjectileId));
            for (int index = 0; index < activeAtFrameStart.Count; index += 1)
            {
                ProjectileState projectile = activeAtFrameStart[index];
                if (projectile.Alive)
                {
                    AdvanceProjectileWindow(projectile, elapsed, 0d, stableTargets, frameStart);
                }
            }

            // Keep the simulation clock unrounded. Rounding every outer frame makes the same
            // fixed guidance slices drift differently at 30, 60, and 120 Hz.
            _elapsedSeconds = frameStart + elapsed;
            _currentFrameEvents.Sort(EventComparer.Instance);
            BusterProjectileEventRecord[] frameEvents = _currentFrameEvents.ToArray();
            _currentFrameEvents = null;
            return new BusterProjectileAdvanceResult(
                frameStart,
                _elapsedSeconds,
                ActiveProjectileCount,
                Complete,
                frameEvents);
        }

        public BusterProjectileExecutionSnapshot CreateSnapshot()
        {
            var sorted = new List<BusterProjectileEventRecord>(_events);
            sorted.Sort(EventComparer.Instance);
            return new BusterProjectileExecutionSnapshot(
                ExecutionId,
                WeaponKey,
                BuildId,
                BuildRevision,
                _elapsedSeconds,
                Complete,
                ActiveProjectileCount,
                _packetBudget,
                sorted);
        }

        public static BusterProjectileExecutionSnapshot SimulateToCompletion(
            CompiledBusterPlan plan,
            BusterProjectileExecutionRequest request,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets,
            double frameStepSeconds = BusterProjectileKernelRules.GuidanceStepSeconds,
            double maximumDurationSeconds = 10d)
        {
            double step = Math.Max(0.001d, FiniteOr(
                frameStepSeconds,
                BusterProjectileKernelRules.GuidanceStepSeconds));
            double maximum = Math.Max(0d, FiniteOr(maximumDurationSeconds, 10d));
            var execution = new BusterProjectileExecution(plan, request);
            while (!execution.Complete
                && execution.ElapsedSeconds < maximum - BusterProjectileKernelRules.EventEpsilon)
            {
                execution.Advance(
                    Math.Min(step, maximum - execution.ElapsedSeconds),
                    targets);
            }

            return execution.CreateSnapshot();
        }

        private void AdvanceProjectileWindow(
            ProjectileState projectile,
            double window,
            double frameOffset,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets,
            double frameStart)
        {
            double remaining = Math.Max(0d, window);
            double offset = Math.Max(0d, frameOffset);
            int processed = 0;
            while (projectile.Alive
                && remaining > BusterProjectileKernelRules.EventEpsilon
                && processed < BusterProjectileKernelRules.MaximumEventsPerFrame)
            {
                double slice = projectile.Action.Guidance
                    ? Math.Min(remaining, BusterProjectileKernelRules.GuidanceStepSeconds)
                    : remaining;
                AdvanceOutcome outcome = AdvanceProjectile(
                    projectile,
                    slice,
                    offset,
                    targets,
                    frameStart);
                double consumed = BusterTrajectoryKernel.Clamp(
                    outcome?.ConsumedTime ?? slice,
                    0d,
                    slice);
                double childWindow = Math.Max(0d, remaining - consumed);
                double childOffset = offset + consumed;
                IReadOnlyList<ProjectileState> spawned = outcome?.Spawned
                    ?? Array.Empty<ProjectileState>();
                for (int index = 0; index < spawned.Count; index += 1)
                {
                    AdvanceProjectileWindow(
                        spawned[index],
                        childWindow,
                        childOffset,
                        targets,
                        frameStart);
                }

                remaining = childWindow;
                offset = childOffset;
                processed += 1;
                if (!projectile.Alive
                    || consumed <= BusterProjectileKernelRules.EventEpsilon)
                {
                    break;
                }
            }
        }

        private AdvanceOutcome AdvanceProjectile(
            ProjectileState projectile,
            double elapsed,
            double frameOffset,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets,
            double frameStart)
        {
            double sliceStart = frameStart + frameOffset;
            SteerProjectile(projectile, elapsed, sliceStart, targets);
            double travel = projectile.Speed * elapsed;
            BusterVector3 previousPosition = projectile.Position;
            Func<double, BusterVector3> positionAt = fraction =>
                BusterTrajectoryKernel.SampleSegment(
                    previousPosition,
                    projectile.Direction,
                    travel,
                    projectile.Distance,
                    projectile.Range,
                    projectile.BaseY,
                    projectile.EndY,
                    projectile.ArcHeight,
                    fraction);

            ArbitrationCandidate selected = null;
            if (IsCarrier(projectile) && _triggerAction?.Trigger != null)
            {
                BusterTriggerConfiguration trigger = _triggerAction.Trigger;
                if (string.Equals(trigger.Event, "delay", StringComparison.Ordinal))
                {
                    double delay = Math.Max(0d, FiniteOr(trigger.Delay, 0.6d));
                    if (projectile.Elapsed < delay - 0.000000001d
                        && projectile.Elapsed + elapsed >= delay - 0.000000001d)
                    {
                        double fraction = BusterTrajectoryKernel.Clamp(
                            (delay - projectile.Elapsed) / Math.Max(elapsed, 0.000000001d),
                            0d,
                            1d);
                        selected = ChooseEarlier(
                            selected,
                            ArbitrationCandidate.ForTrigger(fraction, fraction * elapsed, "delay"));
                    }
                }
                else if (string.Equals(trigger.Event, "apex", StringComparison.Ordinal))
                {
                    double apexProgress = BusterTrajectoryKernel.GetBallisticApexProgress(
                        new BusterVector3(0d, projectile.BaseY, 0d),
                        new BusterVector3(0d, projectile.EndY, 0d),
                        projectile.ArcHeight);
                    double apexDistance = projectile.Range * apexProgress;
                    if (projectile.Distance < apexDistance - 0.000000001d
                        && projectile.Distance + travel >= apexDistance - 0.000000001d)
                    {
                        double fraction = BusterTrajectoryKernel.Clamp(
                            (apexDistance - projectile.Distance) / Math.Max(travel, 0.000000001d),
                            0d,
                            1d);
                        selected = ChooseEarlier(
                            selected,
                            ArbitrationCandidate.ForTrigger(fraction, fraction * elapsed, "apex"));
                    }
                }
            }

            ImpactCandidate impact = FindImpact(projectile, previousPosition, positionAt, targets);
            if (impact != null)
            {
                selected = ChooseEarlier(
                    selected,
                    ArbitrationCandidate.ForImpact(impact, impact.Fraction * elapsed));
            }

            if (projectile.Distance + travel >= projectile.Range - 0.000000001d)
            {
                double fraction = BusterTrajectoryKernel.Clamp(
                    (projectile.Range - projectile.Distance) / Math.Max(travel, 0.000000001d),
                    0d,
                    1d);
                selected = ChooseEarlier(
                    selected,
                    ArbitrationCandidate.ForRange(fraction, fraction * elapsed));
            }

            if (selected == null)
            {
                projectile.Position = positionAt(1d);
                projectile.Distance += travel;
                projectile.Elapsed += elapsed;
                return new AdvanceOutcome(elapsed, Array.Empty<ProjectileState>());
            }

            projectile.Position = positionAt(selected.Fraction);
            projectile.Distance += travel * selected.Fraction;
            projectile.Elapsed += elapsed * selected.Fraction;
            double eventTime = CanonicalTime(sliceStart + selected.Time);
            if (selected.Kind == ArbitrationKind.Trigger)
            {
                string reason = selected.Reason + "Trigger";
                IReadOnlyList<ProjectileState> spawned = SpawnChild(projectile, reason, eventTime);
                DisposeProjectile(projectile, reason, eventTime);
                return new AdvanceOutcome(selected.Time, spawned);
            }

            if (selected.Kind == ArbitrationKind.Impact)
            {
                IReadOnlyList<ProjectileState> spawned = Array.Empty<ProjectileState>();
                if (IsCarrier(projectile) && _triggerAction?.Trigger != null)
                {
                    BusterTriggerConfiguration trigger = _triggerAction.Trigger;
                    if (string.Equals(trigger.Event, "impact", StringComparison.Ordinal)
                        && projectile.Action.DamagePower > 0d)
                    {
                        RecordHit(
                            BusterProjectileEventKind.DirectHit,
                            projectile,
                            selected.Impact.Target,
                            selected.Impact.WeakPoint,
                            projectile.Action.DamagePower,
                            eventTime);
                    }

                    spawned = SpawnChild(
                        projectile,
                        string.Equals(trigger.Event, "impact", StringComparison.Ordinal)
                            ? "terminalRelay"
                            : "earlyCarrierTermination",
                        eventTime);
                }
                else if (IsExplosion(projectile.Action))
                {
                    Detonate(projectile, targets, eventTime);
                }
                else
                {
                    double power = projectile.Action.DamagePower > 0d
                        ? projectile.Action.DamagePower
                        : projectile.Action.Power;
                    RecordHit(
                        BusterProjectileEventKind.DirectHit,
                        projectile,
                        selected.Impact.Target,
                        selected.Impact.WeakPoint,
                        power,
                        eventTime);
                }

                DisposeProjectile(projectile, "impact", eventTime);
                return new AdvanceOutcome(selected.Time, spawned);
            }

            Record(
                BusterProjectileEventKind.RangeEnd,
                projectile,
                eventTime,
                sortPriority: 60,
                reason: "rangeEnd");
            IReadOnlyList<ProjectileState> rangeSpawned = Array.Empty<ProjectileState>();
            if (IsCarrier(projectile) && _triggerAction?.Trigger != null)
            {
                rangeSpawned = SpawnChild(
                    projectile,
                    string.Equals(_triggerAction.Trigger.Event, "impact", StringComparison.Ordinal)
                        ? "terminalRelay"
                        : "earlyCarrierTermination",
                    eventTime);
            }
            else if (IsExplosion(projectile.Action))
            {
                Detonate(projectile, targets, eventTime);
            }

            DisposeProjectile(projectile, "rangeEnd", eventTime);
            return new AdvanceOutcome(selected.Time, rangeSpawned);
        }

        private ImpactCandidate FindImpact(
            ProjectileState projectile,
            BusterVector3 previousPosition,
            Func<double, BusterVector3> positionAt,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets)
        {
            ImpactCandidate selected = null;
            for (int index = 0; index < targets.Count; index += 1)
            {
                BusterProjectileTargetSnapshot target = targets[index];
                if (!target.Active || target.Dead)
                {
                    continue;
                }

                double? bodyFraction = projectile.ArcHeight > 0d
                    ? BusterCollisionKernel.FindSampledCapsuleHitFraction(
                        positionAt,
                        target,
                        projectile.Radius)
                    : BusterCollisionKernel.FindStraightCapsuleHitFraction(
                        previousPosition,
                        positionAt(1d),
                        target,
                        projectile.Radius);
                double? weakFraction = target.HasWeakPoint
                    ? BusterCollisionKernel.FindSphereHitFraction(
                        positionAt,
                        target.WeakPoint,
                        target.WeakPointRadius + projectile.Radius)
                    : null;
                double? fraction = weakFraction.HasValue
                    && (!bodyFraction.HasValue
                        || weakFraction.Value
                            <= bodyFraction.Value + BusterProjectileKernelRules.EventEpsilon)
                    ? weakFraction
                    : bodyFraction;
                if (!fraction.HasValue)
                {
                    continue;
                }

                var candidate = new ImpactCandidate(
                    fraction.Value,
                    target,
                    weakFraction.HasValue
                        && Math.Abs(weakFraction.Value - fraction.Value)
                            <= BusterProjectileKernelRules.EventEpsilon);
                selected = ChooseEarlierImpact(selected, candidate);
            }

            return selected;
        }

        private void SteerProjectile(
            ProjectileState projectile,
            double elapsed,
            double eventTime,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets)
        {
            if (!projectile.Action.Guidance)
            {
                return;
            }

            BusterProjectileTargetSnapshot chosen = null;
            bool locked = false;
            if (!string.IsNullOrEmpty(projectile.LockedTargetId))
            {
                for (int index = 0; index < targets.Count; index += 1)
                {
                    BusterProjectileTargetSnapshot target = targets[index];
                    if (string.Equals(
                            target.StableId,
                            projectile.LockedTargetId,
                            StringComparison.Ordinal)
                        && target.Active
                        && !target.Dead)
                    {
                        chosen = target;
                        locked = true;
                        break;
                    }
                }
            }

            if (chosen == null)
            {
                double selectedDistance = Math.Pow(Math.Max(1d, projectile.Range), 2d);
                string selectedId = "\uffff";
                for (int index = 0; index < targets.Count; index += 1)
                {
                    BusterProjectileTargetSnapshot target = targets[index];
                    if (!target.Active || target.Dead)
                    {
                        continue;
                    }

                    double distance = BusterVector3.DistanceSquared(
                        projectile.Position,
                        target.AimPoint);
                    if (distance < selectedDistance - BusterProjectileKernelRules.EventEpsilon
                        || (Math.Abs(distance - selectedDistance)
                                <= BusterProjectileKernelRules.EventEpsilon
                            && string.CompareOrdinal(target.StableId, selectedId) < 0))
                    {
                        chosen = target;
                        selectedDistance = distance;
                        selectedId = target.StableId;
                    }
                }
            }

            if (chosen == null)
            {
                return;
            }

            if (!string.Equals(
                projectile.GuidanceTargetId,
                chosen.StableId,
                StringComparison.Ordinal))
            {
                projectile.GuidanceTargetId = chosen.StableId;
                Record(
                    BusterProjectileEventKind.GuidanceTarget,
                    projectile,
                    eventTime,
                    sortPriority: 0,
                    targetId: chosen.StableId,
                    reason: locked ? "locked" : "acquired");
            }

            projectile.Direction = BusterTrajectoryKernel.SteerDirection(
                projectile.Direction,
                chosen.AimPoint - projectile.Position,
                BusterProjectileKernelRules.GuidanceStrength,
                elapsed);
        }

        private IReadOnlyList<ProjectileState> SpawnChild(
            ProjectileState carrier,
            string reason,
            double eventTime)
        {
            if (_childAction == null)
            {
                return Array.Empty<ProjectileState>();
            }

            IReadOnlyList<ProjectileState> spawned = SpawnAction(
                _childAction,
                carrier.Position,
                carrier.Direction,
                carrier.ExecutionAimPoint,
                "child",
                null,
                eventTime);
            Record(
                BusterProjectileEventKind.ChildTrigger,
                carrier,
                eventTime,
                sortPriority: 30,
                reason: reason);
            return spawned;
        }

        private IReadOnlyList<ProjectileState> SpawnAction(
            BusterAction action,
            BusterVector3 origin,
            BusterVector3 baseDirection,
            BusterVector3 aimPoint,
            string scope,
            string lockedTargetId,
            double eventTime)
        {
            BusterVector3 direction = baseDirection.Normalized(BusterVector3.Forward);
            IReadOnlyList<BusterVector3> directions;
            if (string.Equals(action.Splitter?.Pattern, "spread", StringComparison.Ordinal))
            {
                directions = BusterTrajectoryKernel.GetSpreadDirections(
                    direction,
                    action.Splitter.AngleOffsets);
            }
            else if (string.Equals(action.Splitter?.Pattern, "radial", StringComparison.Ordinal))
            {
                directions = BusterTrajectoryKernel.GetClusterDirections(
                    direction,
                    action.Count > 0 ? action.Count : action.Splitter.Count);
            }
            else
            {
                int count = Math.Max(1, action.Count);
                var repeated = new BusterVector3[count];
                for (int index = 0; index < count; index += 1)
                {
                    repeated[index] = direction;
                }

                directions = Array.AsReadOnly(repeated);
            }

            var spawned = new List<ProjectileState>(directions.Count);
            for (int index = 0; index < directions.Count; index += 1)
            {
                bool ballistic = string.Equals(
                    action.Trajectory,
                    "ballistic",
                    StringComparison.Ordinal);
                BusterVector3 sourceDirection = directions[index];
                BusterVector3 authoredDirection = new BusterVector3(
                    sourceDirection.X,
                    ballistic ? 0d : sourceDirection.Y,
                    sourceDirection.Z).Normalized(BusterVector3.Forward);
                string projectileId = ExecutionId
                    + ":projectile:"
                    + (++_projectileCounter).ToString("D4", CultureInfo.InvariantCulture);
                var projectile = new ProjectileState(
                    projectileId,
                    index,
                    action,
                    scope,
                    origin,
                    authoredDirection,
                    Math.Max(0d, FiniteOr(action.Speed, 0d)),
                    Math.Max(0.001d, FiniteOr(action.Range, 1d)),
                    string.Equals(action.ModuleId, "mortarShell", StringComparison.Ordinal)
                        ? BusterProjectileKernelRules.MortarProjectileRadius
                        : BusterProjectileKernelRules.PulseProjectileRadius,
                    ballistic ? Math.Max(1.15d, FiniteOr(action.Range, 0d) * 0.2d) : 0d,
                    origin.Y,
                    aimPoint.Y,
                    aimPoint,
                    string.Equals(scope, "root", StringComparison.Ordinal)
                        && action.Guidance
                        ? lockedTargetId
                        : null);
                _projectiles.Add(projectile);
                spawned.Add(projectile);
                Record(
                    BusterProjectileEventKind.ProjectileSpawn,
                    projectile,
                    eventTime,
                    sortPriority: 20);
            }

            return Array.AsReadOnly(spawned.ToArray());
        }

        private void Detonate(
            ProjectileState projectile,
            IReadOnlyList<BusterProjectileTargetSnapshot> targets,
            double eventTime)
        {
            double radius = Math.Max(0d, projectile.Action.Payload?.Radius ?? 1.55d);
            double power = projectile.Action.Power > 0d
                ? projectile.Action.Power
                : projectile.Action.DamagePower;
            for (int index = 0; index < targets.Count; index += 1)
            {
                BusterProjectileTargetSnapshot target = targets[index];
                if (!target.Active
                    || target.Dead
                    || !BusterCollisionKernel.SphereIntersectsTargetCapsule(
                        projectile.Position,
                        radius,
                        target))
                {
                    continue;
                }

                RecordHit(
                    BusterProjectileEventKind.ExplosionHit,
                    projectile,
                    target,
                    false,
                    power,
                    eventTime);
            }

            Record(
                BusterProjectileEventKind.Explosion,
                projectile,
                eventTime,
                sortPriority: 50,
                payloadType: projectile.Action.Payload?.Type);
        }

        private void RecordHit(
            BusterProjectileEventKind kind,
            ProjectileState projectile,
            BusterProjectileTargetSnapshot target,
            bool weakPoint,
            double power,
            double eventTime)
        {
            Record(
                kind,
                projectile,
                eventTime,
                sortPriority: kind == BusterProjectileEventKind.DirectHit ? 10 : 40,
                targetId: target?.StableId,
                power: power,
                payloadType: projectile.Action.Payload?.Type,
                weakPoint: weakPoint);
        }

        private void DisposeProjectile(
            ProjectileState projectile,
            string reason,
            double eventTime)
        {
            if (!projectile.Alive)
            {
                return;
            }

            projectile.Alive = false;
            Record(
                BusterProjectileEventKind.Disposed,
                projectile,
                eventTime,
                sortPriority: 70,
                reason: reason);
        }

        private void Record(
            BusterProjectileEventKind kind,
            ProjectileState projectile,
            double eventTime,
            int sortPriority,
            string targetId = null,
            string reason = null,
            double power = 0d,
            string payloadType = null,
            bool weakPoint = false)
        {
            var record = new BusterProjectileEventRecord(
                kind,
                CanonicalTime(eventTime),
                sortPriority,
                ++_eventSequence,
                ExecutionId,
                ReservationToken,
                WeaponKey,
                BuildId,
                BuildRevision,
                projectile.ProjectileId,
                projectile.ProjectileIndex,
                projectile.Action.ActionId,
                projectile.Scope,
                targetId,
                reason,
                projectile.Position,
                projectile.Direction,
                power,
                payloadType,
                weakPoint);
            _events.Add(record);
            _currentFrameEvents?.Add(record);
        }

        private static BusterPacketBudget CreatePacketBudget(
            CompiledBusterPlan plan,
            BusterAction rootAction,
            BusterAction childAction)
        {
            bool carrier = string.Equals(
                rootAction.ActionId,
                "emit-carrier",
                StringComparison.Ordinal);
            BusterAction terminal = carrier && childAction != null ? childAction : rootAction;
            double carrierPower = carrier ? Math.Max(0d, rootAction.DamagePower) : 0d;
            int terminalCount = Math.Max(1, terminal.Count);
            double terminalPower = terminal.TotalPower > 0d
                ? terminal.TotalPower
                : Math.Max(0d, terminal.Power) * terminalCount;
            return new BusterPacketBudget(
                Math.Max(0d, plan.Stats.EffectivePower),
                carrierPower,
                terminalCount,
                Math.Max(0d, terminal.Power),
                terminalPower);
        }

        private static BusterAction FindAction(
            IReadOnlyList<BusterAction> actions,
            string type,
            string scope)
        {
            for (int index = 0; index < actions.Count; index += 1)
            {
                BusterAction action = actions[index];
                if (string.Equals(action.Type, type, StringComparison.Ordinal)
                    && (scope == null
                        || string.Equals(action.Scope, scope, StringComparison.Ordinal)))
                {
                    return action;
                }
            }

            return null;
        }

        private static bool IsCarrier(ProjectileState projectile)
        {
            return string.Equals(
                projectile.Action.ActionId,
                "emit-carrier",
                StringComparison.Ordinal);
        }

        private static bool IsExplosion(BusterAction action)
        {
            return string.Equals(action.Payload?.Type, "explosion", StringComparison.Ordinal);
        }

        private static IReadOnlyList<BusterProjectileTargetSnapshot> SortTargets(
            IReadOnlyList<BusterProjectileTargetSnapshot> targets)
        {
            var result = new List<BusterProjectileTargetSnapshot>();
            if (targets != null)
            {
                for (int index = 0; index < targets.Count; index += 1)
                {
                    if (targets[index] != null)
                    {
                        result.Add(targets[index]);
                    }
                }
            }

            result.Sort((left, right) =>
                string.CompareOrdinal(left.StableId, right.StableId));
            return Array.AsReadOnly(result.ToArray());
        }

        private static ArbitrationCandidate ChooseEarlier(
            ArbitrationCandidate current,
            ArbitrationCandidate candidate)
        {
            if (candidate == null)
            {
                return current;
            }

            if (current == null)
            {
                return candidate;
            }

            if (candidate.Time < current.Time - BusterProjectileKernelRules.EventEpsilon)
            {
                return candidate;
            }

            if (Math.Abs(candidate.Time - current.Time)
                <= BusterProjectileKernelRules.EventEpsilon)
            {
                if (candidate.Priority < current.Priority)
                {
                    return candidate;
                }

                if (candidate.Priority == current.Priority
                    && string.CompareOrdinal(candidate.StableId, current.StableId) < 0)
                {
                    return candidate;
                }
            }

            return current;
        }

        private static ImpactCandidate ChooseEarlierImpact(
            ImpactCandidate current,
            ImpactCandidate candidate)
        {
            if (candidate == null)
            {
                return current;
            }

            if (current == null)
            {
                return candidate;
            }

            if (candidate.Fraction
                < current.Fraction - BusterProjectileKernelRules.EventEpsilon)
            {
                return candidate;
            }

            if (Math.Abs(candidate.Fraction - current.Fraction)
                    <= BusterProjectileKernelRules.EventEpsilon
                && string.CompareOrdinal(
                    candidate.Target.StableId,
                    current.Target.StableId) < 0)
            {
                return candidate;
            }

            return current;
        }

        private static double CanonicalTime(double value)
        {
            return Math.Round(FiniteOr(value, 0d), 12, MidpointRounding.AwayFromZero);
        }

        private static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }

        private sealed class ProjectileState
        {
            public ProjectileState(
                string projectileId,
                int projectileIndex,
                BusterAction action,
                string scope,
                BusterVector3 position,
                BusterVector3 direction,
                double speed,
                double range,
                double radius,
                double arcHeight,
                double baseY,
                double endY,
                BusterVector3 executionAimPoint,
                string lockedTargetId)
            {
                ProjectileId = projectileId;
                ProjectileIndex = projectileIndex;
                Action = action;
                Scope = scope;
                Position = position;
                Direction = direction;
                Speed = speed;
                Range = range;
                Radius = radius;
                ArcHeight = arcHeight;
                BaseY = baseY;
                EndY = endY;
                ExecutionAimPoint = executionAimPoint;
                LockedTargetId = lockedTargetId;
                Alive = true;
            }

            public string ProjectileId { get; }
            public int ProjectileIndex { get; }
            public BusterAction Action { get; }
            public string Scope { get; }
            public BusterVector3 Position { get; set; }
            public BusterVector3 Direction { get; set; }
            public double Speed { get; }
            public double Range { get; }
            public double Radius { get; }
            public double ArcHeight { get; }
            public double BaseY { get; }
            public double EndY { get; }
            public BusterVector3 ExecutionAimPoint { get; }
            public string LockedTargetId { get; }
            public string GuidanceTargetId { get; set; }
            public double Distance { get; set; }
            public double Elapsed { get; set; }
            public bool Alive { get; set; }
        }

        private enum ArbitrationKind
        {
            Trigger,
            Impact,
            Range
        }

        private sealed class ArbitrationCandidate
        {
            private ArbitrationCandidate(
                ArbitrationKind kind,
                double fraction,
                double time,
                int priority,
                string stableId,
                string reason,
                ImpactCandidate impact)
            {
                Kind = kind;
                Fraction = fraction;
                Time = time;
                Priority = priority;
                StableId = stableId ?? string.Empty;
                Reason = reason;
                Impact = impact;
            }

            public ArbitrationKind Kind { get; }
            public double Fraction { get; }
            public double Time { get; }
            public int Priority { get; }
            public string StableId { get; }
            public string Reason { get; }
            public ImpactCandidate Impact { get; }

            public static ArbitrationCandidate ForTrigger(
                double fraction,
                double time,
                string reason)
            {
                return new ArbitrationCandidate(
                    ArbitrationKind.Trigger,
                    fraction,
                    time,
                    0,
                    reason,
                    reason,
                    null);
            }

            public static ArbitrationCandidate ForImpact(ImpactCandidate impact, double time)
            {
                return new ArbitrationCandidate(
                    ArbitrationKind.Impact,
                    impact.Fraction,
                    time,
                    1,
                    impact.Target.StableId,
                    null,
                    impact);
            }

            public static ArbitrationCandidate ForRange(double fraction, double time)
            {
                return new ArbitrationCandidate(
                    ArbitrationKind.Range,
                    fraction,
                    time,
                    2,
                    "range",
                    null,
                    null);
            }
        }

        private sealed class ImpactCandidate
        {
            public ImpactCandidate(
                double fraction,
                BusterProjectileTargetSnapshot target,
                bool weakPoint)
            {
                Fraction = fraction;
                Target = target;
                WeakPoint = weakPoint;
            }

            public double Fraction { get; }
            public BusterProjectileTargetSnapshot Target { get; }
            public bool WeakPoint { get; }
        }

        private sealed class AdvanceOutcome
        {
            public AdvanceOutcome(double consumedTime, IReadOnlyList<ProjectileState> spawned)
            {
                ConsumedTime = consumedTime;
                Spawned = spawned;
            }

            public double ConsumedTime { get; }
            public IReadOnlyList<ProjectileState> Spawned { get; }
        }

        private sealed class EventComparer : IComparer<BusterProjectileEventRecord>
        {
            public static readonly EventComparer Instance = new EventComparer();

            public int Compare(
                BusterProjectileEventRecord left,
                BusterProjectileEventRecord right)
            {
                if (ReferenceEquals(left, right))
                {
                    return 0;
                }

                if (left == null)
                {
                    return -1;
                }

                if (right == null)
                {
                    return 1;
                }

                int comparison = left.Time.CompareTo(right.Time);
                if (comparison != 0)
                {
                    return comparison;
                }

                comparison = left.SortPriority.CompareTo(right.SortPriority);
                if (comparison != 0)
                {
                    return comparison;
                }

                comparison = string.CompareOrdinal(left.ProjectileId, right.ProjectileId);
                if (comparison != 0)
                {
                    return comparison;
                }

                comparison = string.CompareOrdinal(left.TargetId, right.TargetId);
                if (comparison != 0)
                {
                    return comparison;
                }

                return left.StableSequence.CompareTo(right.StableSequence);
            }
        }
    }
}
