using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Buster.ProjectileKernel;

namespace RuinCrawler.Core.Buster.Tests
{
    public sealed class BusterProjectileKernelEditModeTests
    {
        private static readonly BusterVector3 Muzzle = new BusterVector3(0d, 1.05d, 0d);

        [Test]
        public void CollisionHelpersMatchExportedAsymmetricCapsuleFixture()
        {
            var target = new BusterProjectileTargetSnapshot(
                "asymmetric-target",
                new BusterVector3(1.2d, 0d, 3.45d),
                radius: 0.7d,
                collisionHeight: 2.4d);

            double? fraction = BusterCollisionKernel.FindStraightCapsuleHitFraction(
                new BusterVector3(-4.25d, 1.1d, -2.5d),
                new BusterVector3(3.75d, 1.1d, 6.5d),
                target,
                0.18d);

            Assert.That(fraction, Is.Not.Null);
            Assert.That(fraction.Value, Is.EqualTo(0.5976073923286597d).Within(1e-8));

            var body = new BusterProjectileTargetSnapshot(
                "body",
                BusterVector3.Zero,
                radius: 0.58d,
                collisionHeight: 1.8d);
            BusterVerticalCapsule capsule = BusterCollisionKernel.GetVerticalCapsule(body);
            Assert.That(capsule.BottomY, Is.EqualTo(0.58d).Within(1e-12));
            Assert.That(capsule.TopY, Is.EqualTo(1.22d).Within(1e-12));
            Assert.That(BusterCollisionKernel.SphereIntersectsTargetCapsule(
                new BusterVector3(0d, 2d, 0d),
                0.2d,
                body), Is.True);
        }

        [Test]
        public void SpreadClusterAndBallisticSamplesAreDeterministicAndElevationAware()
        {
            BusterVector3 direction = BusterVector3.Forward;
            IReadOnlyList<BusterVector3> firstSpread = BusterTrajectoryKernel.GetSpreadDirections(
                direction,
                new[] { -0.14d, 0d, 0.14d });
            IReadOnlyList<BusterVector3> secondSpread = BusterTrajectoryKernel.GetSpreadDirections(
                direction,
                new[] { -0.14d, 0d, 0.14d });
            Assert.That(firstSpread, Is.EqualTo(secondSpread));
            Assert.That(firstSpread[0].X, Is.LessThan(0d));
            Assert.That(firstSpread[2].X, Is.GreaterThan(0d));

            IReadOnlyList<BusterVector3> cluster = BusterTrajectoryKernel.GetClusterDirections(
                new BusterVector3(0d, 1d, 0d),
                5);
            Assert.That(cluster.Count, Is.EqualTo(5));
            Assert.That(cluster.Select(VectorKey).Distinct().Count(), Is.EqualTo(5));
            Assert.That(cluster.All(value => Math.Abs(value.Length - 1d) < 1e-9d), Is.True);

            BusterVector3 start = new BusterVector3(0d, 1d, 0d);
            BusterVector3 end = new BusterVector3(6d, 3d, 0d);
            double apex = BusterTrajectoryKernel.GetBallisticApexProgress(start, end, 2d);
            Assert.That(apex, Is.GreaterThan(0.5d).And.LessThan(1d));
            Assert.That(
                BusterTrajectoryKernel.SampleBallisticPoint(start, end, 2d, apex).Y,
                Is.GreaterThan(3d));
            Assert.That(
                BusterTrajectoryKernel.SampleBallisticPoint(start, end, 2d, 1d).Y,
                Is.EqualTo(3d).Within(1e-12));
        }

        [Test]
        public void PacketBudgetConservesCompiledPowerForDirectSpreadAndTriggeredCluster()
        {
            CompiledBusterPlan direct = BusterTestPlans.PulseSpreadExplosion();
            CompiledBusterPlan triggered = BusterTestPlans.ApexClusterExplosion();

            BusterPacketBudget directBudget = CreateExecution(direct, "direct-budget").PacketBudget;
            BusterPacketBudget triggeredBudget = CreateExecution(triggered, "trigger-budget").PacketBudget;

            Assert.That(directBudget.IsConserved, Is.True);
            Assert.That(directBudget.TerminalProjectileCount, Is.EqualTo(3));
            Assert.That(
                directBudget.PerTerminalProjectilePower * directBudget.TerminalProjectileCount,
                Is.EqualTo(directBudget.TerminalProjectilePower).Within(1e-12));
            Assert.That(directBudget.TotalAllocatedPower,
                Is.EqualTo(direct.Stats.EffectivePower).Within(1e-12));

            Assert.That(triggeredBudget.IsConserved, Is.True);
            Assert.That(triggeredBudget.TerminalProjectileCount, Is.EqualTo(5));
            Assert.That(triggeredBudget.CarrierDamagePower, Is.Zero.Within(1e-12));
            Assert.That(triggeredBudget.TotalAllocatedPower,
                Is.EqualTo(triggered.Stats.EffectivePower).Within(1e-12));
        }

        [Test]
        public void DelayTriggerWinsBeforeLaterImpactAndChildrenConsumeFrameRemainder()
        {
            CompiledBusterPlan plan = CompileDelayGuidedCluster("delay-before-impact", revision: 3);
            var target = Target("target", 5d);
            var execution = CreateExecution(plan, "delay-order", target.StableId);

            BusterProjectileAdvanceResult result = execution.Advance(0.7d, new[] { target });
            BusterProjectileExecutionSnapshot snapshot = execution.CreateSnapshot();
            BusterProjectileEventRecord trigger = snapshot.Events.Single(
                entry => entry.Kind == BusterProjectileEventKind.ChildTrigger);

            Assert.That(trigger.Time, Is.EqualTo(0.6d).Within(1e-12));
            Assert.That(trigger.Reason, Is.EqualTo("delayTrigger"));
            Assert.That(snapshot.Events.Count(entry =>
                entry.Kind == BusterProjectileEventKind.ProjectileSpawn
                && entry.Scope == "child"), Is.EqualTo(5));
            Assert.That(snapshot.Events.Count(entry =>
                entry.Kind == BusterProjectileEventKind.GuidanceTarget
                && entry.Scope == "child"), Is.EqualTo(5));
            Assert.That(result.ActiveProjectileCount, Is.EqualTo(5));
            Assert.That(snapshot.Events.Any(entry =>
                entry.Scope == "child"
                && entry.Kind == BusterProjectileEventKind.Disposed
                && entry.Time <= 0.7d), Is.False);

            BusterProjectileEventRecord carrierDisposal = snapshot.Events.Single(entry =>
                entry.Scope == "root"
                && entry.Kind == BusterProjectileEventKind.Disposed);
            Assert.That(carrierDisposal.Reason, Is.EqualTo("delayTrigger"));
            Assert.That(snapshot.Events.Any(entry =>
                entry.Scope == "root"
                && entry.Kind == BusterProjectileEventKind.DirectHit), Is.False);
        }

        [Test]
        public void ApexTriggerUsesExactBallisticCrossingBeforeRange()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();
            BusterProjectileExecutionSnapshot snapshot = BusterProjectileExecution.SimulateToCompletion(
                plan,
                Request("apex-execution", new BusterVector3(0d, 1.05d, 10d)),
                Array.Empty<BusterProjectileTargetSnapshot>(),
                frameStepSeconds: 0.35d,
                maximumDurationSeconds: 4d);
            BusterProjectileEventRecord trigger = snapshot.Events.Single(
                entry => entry.Kind == BusterProjectileEventKind.ChildTrigger);

            Assert.That(trigger.Reason, Is.EqualTo("apexTrigger"));
            Assert.That(trigger.Time,
                Is.EqualTo(plan.Trajectory.TriggerNominalTime.Value).Within(1e-9));
            Assert.That(snapshot.Events.Count(entry =>
                entry.Kind == BusterProjectileEventKind.Explosion), Is.EqualTo(5));
            Assert.That(snapshot.Complete, Is.True);
        }

        [Test]
        public void ApexTriggerWinsAnExactTimeTieWithCapsuleImpact()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();
            double apexZ = plan.Stats.RootRange * 0.5d;
            var tangent = new BusterProjectileTargetSnapshot(
                "tangent-impact",
                new BusterVector3(0.52d, 0d, apexZ),
                radius: 0.3d,
                collisionHeight: 4d,
                aimPoint: new BusterVector3(0.52d, 2d, apexZ));
            BusterProjectileExecutionSnapshot snapshot =
                BusterProjectileExecution.SimulateToCompletion(
                    plan,
                    Request("apex-tie", new BusterVector3(0d, 1.05d, plan.Stats.RootRange)),
                    new[] { tangent },
                    frameStepSeconds: 1d,
                    maximumDurationSeconds: 3d);

            Assert.That(snapshot.Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.ChildTrigger).Reason,
                Is.EqualTo("apexTrigger"));
            Assert.That(snapshot.Events.Any(entry =>
                entry.Scope == "root"
                && entry.Kind == BusterProjectileEventKind.DirectHit), Is.False);
        }

        [Test]
        public void TerminalRelayDeliversCarrierThenChildExplosionAtSameImpactTime()
        {
            CompiledBusterPlan plan = CompileTerminalRelay("terminal-relay", revision: 8);
            var target = Target("relay-target", 5d);
            BusterProjectileExecutionSnapshot snapshot = BusterProjectileExecution.SimulateToCompletion(
                plan,
                Request("terminal-execution", target.AimPoint),
                new[] { target },
                frameStepSeconds: 0.35d,
                maximumDurationSeconds: 2d);

            BusterProjectileEventRecord direct = snapshot.Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.DirectHit);
            BusterProjectileEventRecord explosion = snapshot.Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.ExplosionHit);
            BusterProjectileEventRecord trigger = snapshot.Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.ChildTrigger);
            Assert.That(trigger.Reason, Is.EqualTo("terminalRelay"));
            Assert.That(trigger.Time, Is.EqualTo(direct.Time).Within(1e-12));
            Assert.That(explosion.Time, Is.EqualTo(direct.Time).Within(1e-12));
            Assert.That(direct.TargetId, Is.EqualTo(target.StableId));
            Assert.That(explosion.TargetId, Is.EqualTo(target.StableId));
            Assert.That(
                direct.Power + plan.ChildPacket.TotalPower,
                Is.EqualTo(plan.Stats.EffectivePower).Within(1e-12));
        }

        [Test]
        public void StableTargetIdsBreakExactImpactAndGuidanceTies()
        {
            CompiledBusterPlan directPlan = BusterTestPlans.Pulse("stable-impact");
            BusterProjectileTargetSnapshot targetB = Target("target-b", 5d);
            BusterProjectileTargetSnapshot targetA = Target("target-a", 5d);
            BusterProjectileExecutionSnapshot direct = BusterProjectileExecution.SimulateToCompletion(
                directPlan,
                Request("stable-impact-execution", targetA.AimPoint),
                new[] { targetB, targetA },
                frameStepSeconds: 1d,
                maximumDurationSeconds: 1d);
            Assert.That(direct.Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.DirectHit).TargetId,
                Is.EqualTo("target-a"));

            CompiledBusterPlan guidancePlan = CompileRootGuidance("stable-guidance");
            var guided = CreateExecution(guidancePlan, "stable-guidance-execution");
            guided.Advance(1d / 120d, new[] { targetB, targetA });
            Assert.That(guided.CreateSnapshot().Events.Single(entry =>
                entry.Kind == BusterProjectileEventKind.GuidanceTarget).TargetId,
                Is.EqualTo("target-a"));
        }

        [Test]
        public void GuidedTriggerLifecycleMatchesAtThirtySixtyOneTwentyAndLargeSteps()
        {
            CompiledBusterPlan plan = CompileDelayGuidedCluster("frame-parity", revision: 11);
            var target = Target("frame-target", 5d);
            double[] steps = { 1d / 30d, 1d / 60d, 1d / 120d, 0.35d };
            string[] baseline = null;
            for (int index = 0; index < steps.Length; index += 1)
            {
                BusterProjectileExecutionSnapshot snapshot =
                    BusterProjectileExecution.SimulateToCompletion(
                        plan,
                        Request("frame-parity-execution", target.AimPoint),
                        new[] { target },
                        frameStepSeconds: steps[index],
                        maximumDurationSeconds: 4d);
                string[] signature = snapshot.Events
                    .Where(entry =>
                        entry.Kind == BusterProjectileEventKind.ChildTrigger
                        || entry.Kind == BusterProjectileEventKind.GuidanceTarget
                        || entry.Kind == BusterProjectileEventKind.DirectHit
                        || entry.Kind == BusterProjectileEventKind.ExplosionHit
                        || entry.Kind == BusterProjectileEventKind.Explosion
                        || entry.Kind == BusterProjectileEventKind.RangeEnd)
                    .Select(EventKey)
                    .ToArray();
                Assert.That(snapshot.Complete, Is.True, $"step {steps[index]:R}");
                Assert.That(snapshot.Events.Count(entry =>
                    entry.Kind == BusterProjectileEventKind.ChildTrigger), Is.EqualTo(1));
                Assert.That(snapshot.Events.Count(entry =>
                    entry.Kind == BusterProjectileEventKind.Explosion), Is.EqualTo(5));
                if (baseline == null)
                {
                    baseline = signature;
                }
                else
                {
                    Assert.That(signature, Is.EqualTo(baseline), $"step {steps[index]:R}");
                }
            }
        }

        [Test]
        public void InFlightEventsRetainCapturedBuildRevisionAfterRecompile()
        {
            CompiledBusterPlan revisionFour = CompileDelayGuidedCluster(
                "captured-revision",
                revision: 4);
            var execution = CreateExecution(revisionFour, "revision-execution");

            CompiledBusterPlan revisionFive = CompileDelayGuidedCluster(
                "captured-revision",
                revision: 5);
            Assert.That(revisionFive.BuildRevision, Is.EqualTo(5));

            while (!execution.Complete && execution.ElapsedSeconds < 4d)
            {
                execution.Advance(0.35d, Array.Empty<BusterProjectileTargetSnapshot>());
            }

            BusterProjectileExecutionSnapshot snapshot = execution.CreateSnapshot();
            Assert.That(snapshot.BuildRevision, Is.EqualTo(4));
            Assert.That(snapshot.Events, Is.Not.Empty);
            Assert.That(snapshot.Events.All(entry => entry.BuildRevision == 4), Is.True);
            Assert.That(snapshot.Events.All(entry =>
                entry.BuildId == revisionFour.BuildId
                && entry.WeaponKey == revisionFour.WeaponKey), Is.True);
        }

        [Test]
        public void EventTranscriptIsChronologicalAndStableWithinExactTies()
        {
            CompiledBusterPlan plan = BusterTestPlans.PulseSpreadExplosion();
            BusterProjectileExecutionSnapshot snapshot = BusterProjectileExecution.SimulateToCompletion(
                plan,
                Request("ordered-transcript", new BusterVector3(0d, 1.05d, 8d)),
                Array.Empty<BusterProjectileTargetSnapshot>(),
                frameStepSeconds: 1d,
                maximumDurationSeconds: 2d);

            for (int index = 1; index < snapshot.Events.Count; index += 1)
            {
                Assert.That(snapshot.Events[index].Time,
                    Is.GreaterThanOrEqualTo(snapshot.Events[index - 1].Time));
            }

            string[] explosionIds = snapshot.Events
                .Where(entry => entry.Kind == BusterProjectileEventKind.Explosion)
                .Select(entry => entry.ProjectileId)
                .ToArray();
            Assert.That(
                explosionIds,
                Is.EqualTo(explosionIds.OrderBy(value => value, StringComparer.Ordinal).ToArray()));
            Assert.That(explosionIds.Length, Is.EqualTo(3));
        }

        private static BusterProjectileExecution CreateExecution(
            CompiledBusterPlan plan,
            string executionId,
            string lockedTargetId = null)
        {
            return new BusterProjectileExecution(
                plan,
                Request(
                    executionId,
                    new BusterVector3(0d, 1.05d, 5d),
                    lockedTargetId));
        }

        private static BusterProjectileExecutionRequest Request(
            string executionId,
            BusterVector3 aimPoint,
            string lockedTargetId = null)
        {
            return new BusterProjectileExecutionRequest(
                executionId,
                Muzzle,
                (aimPoint - Muzzle).Normalized(BusterVector3.Forward),
                aimPoint,
                reservationToken: executionId + ":reservation",
                lockedTargetId: lockedTargetId);
        }

        private static BusterProjectileTargetSnapshot Target(string id, double z)
        {
            return new BusterProjectileTargetSnapshot(
                id,
                new BusterVector3(0d, 0d, z),
                radius: 0.58d,
                collisionHeight: 1.8d,
                aimPoint: new BusterVector3(0d, 1.05d, z));
        }

        private static CompiledBusterPlan CompileDelayGuidedCluster(
            string buildId,
            int revision)
        {
            return Compile(
                buildId,
                revision,
                new[]
                {
                    Node("emitter", "mortarShell", buildId),
                    Node("delay", "afterDelay", buildId, physical: false),
                    Node("guidance", "pursuitGuidance", buildId),
                    Node("cluster", "cluster5", buildId),
                    Node("payload", "explosion", buildId)
                },
                new[]
                {
                    new BusterEdgeSource("emitter", BusterEdgePorts.Next, "delay"),
                    new BusterEdgeSource("delay", BusterEdgePorts.Child, "guidance"),
                    new BusterEdgeSource("guidance", BusterEdgePorts.Next, "cluster"),
                    new BusterEdgeSource("cluster", BusterEdgePorts.Next, "payload")
                });
        }

        private static CompiledBusterPlan CompileTerminalRelay(string buildId, int revision)
        {
            return Compile(
                buildId,
                revision,
                new[]
                {
                    Node("emitter", "pulseBolt", buildId),
                    Node("impact", "onImpact", buildId, physical: false),
                    Node("payload", "explosion", buildId)
                },
                new[]
                {
                    new BusterEdgeSource("emitter", BusterEdgePorts.Next, "impact"),
                    new BusterEdgeSource("impact", BusterEdgePorts.Child, "payload")
                });
        }

        private static CompiledBusterPlan CompileRootGuidance(string buildId)
        {
            return Compile(
                buildId,
                1,
                new[]
                {
                    Node("emitter", "pulseBolt", buildId),
                    Node("guidance", "pursuitGuidance", buildId)
                },
                new[]
                {
                    new BusterEdgeSource("emitter", BusterEdgePorts.Next, "guidance")
                });
        }

        private static CompiledBusterPlan Compile(
            string buildId,
            int revision,
            IReadOnlyList<BusterNodeSource> nodes,
            IReadOnlyList<BusterEdgeSource> edges)
        {
            return BusterCompiler.Compile(new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                buildId,
                "fixture:" + buildId + ":chassis",
                new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource("emitter", nodes, edges),
                revision));
        }

        private static BusterNodeSource Node(
            string nodeId,
            string moduleId,
            string buildId,
            bool physical = true)
        {
            return new BusterNodeSource(
                nodeId,
                moduleId,
                physical ? "fixture:" + buildId + ":" + nodeId : null);
        }

        private static string VectorKey(BusterVector3 value)
        {
            return value.X.ToString("F5", CultureInfo.InvariantCulture)
                + ","
                + value.Y.ToString("F5", CultureInfo.InvariantCulture)
                + ","
                + value.Z.ToString("F5", CultureInfo.InvariantCulture);
        }

        private static string EventKey(BusterProjectileEventRecord entry)
        {
            return entry.Type
                + "|"
                + entry.Time.ToString("F9", CultureInfo.InvariantCulture)
                + "|"
                + entry.ProjectileId
                + "|"
                + entry.TargetId
                + "|"
                + entry.Reason;
        }
    }
}
