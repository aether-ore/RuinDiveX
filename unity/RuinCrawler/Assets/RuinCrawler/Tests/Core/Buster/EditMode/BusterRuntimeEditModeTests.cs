using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace RuinCrawler.Core.Buster.Tests
{
    public sealed class BusterRuntimeEditModeTests
    {
        private sealed class MarkerContext
        {
            public MarkerContext(string marker)
            {
                Marker = marker;
            }

            public string Marker { get; }
        }

        [Test]
        public void NeutralMegaBatteryMatchesExportedRuntimeTranscript()
        {
            var executions = new List<WeaponExecution>();
            var runtime = new BusterRuntime(executeShot: execution =>
            {
                executions.Add(execution);
                return true;
            });
            CompiledBusterPlan plan = BusterCompiler.CompileMega();

            runtime.Equip(plan);
            AssertTelemetry(runtime.GetTelemetry(), 6d, 0d, 0d, true, null, 0);

            for (int shotIndex = 1; shotIndex <= 3; shotIndex += 1)
            {
                WeaponFireResult fired = runtime.Fire(new MarkerContext("shot-" + shotIndex));
                Assert.That(fired.Ok, Is.True);
                Assert.That(fired.Execution.ExecutionId, Is.EqualTo("megaBuster:execution:" + shotIndex));
                Assert.That(fired.Execution.ReservationToken, Is.EqualTo("megaBuster:reservation:" + shotIndex));
                Assert.That(fired.Execution.BuildRevision, Is.Zero);
                Assert.That(fired.Execution.Plan, Is.SameAs(plan));
                AssertTelemetry(
                    runtime.GetTelemetry(),
                    6d - (2d * shotIndex),
                    plan.Stats.CycleTime,
                    0.65d,
                    false,
                    WeaponFireBlockReasons.Cycle,
                    1);

                Assert.That(runtime.ReleaseReservation(fired.Execution.ReservationToken), Is.True);
                runtime.Update(0.25d, plan.WeaponKey);
            }

            WeaponTelemetry empty = runtime.GetTelemetry();
            Assert.That(empty.Energy, Is.Zero);
            Assert.That(empty.RechargeDelayRemaining, Is.EqualTo(0.4d).Within(1e-12));
            Assert.That(empty.BlockReason, Is.EqualTo(WeaponFireBlockReasons.Energy));

            WeaponFireResult blocked = runtime.Fire(new MarkerContext("shot-4"));
            Assert.That(blocked.Ok, Is.False);
            Assert.That(blocked.Reason, Is.EqualTo(WeaponFireBlockReasons.Energy));
            Assert.That(blocked.RecoveryLocked, Is.True);
            Assert.That(runtime.GetTelemetry().BlockReason, Is.EqualTo(WeaponFireBlockReasons.Recovery));

            runtime.Update(0.65d, plan.WeaponKey);
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(5d / 6d).Within(1e-12));
            Assert.That(runtime.GetTelemetry().RecoveryLocked, Is.True);
            runtime.Update(1.8d, plan.WeaponKey);
            AssertTelemetry(runtime.GetTelemetry(), 6d, 0d, 0d, true, null, 0);
            Assert.That(executions.Count, Is.EqualTo(3));
        }

        [Test]
        public void RechargeWaitsForBothSuccessfulShotGatesAndIgnoresInputStyle()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();
            var singleStep = new BusterRuntime(executeShot: _ => true);
            var splitSteps = new BusterRuntime(executeShot: _ => true);
            singleStep.Equip(plan);
            splitSteps.Equip(plan);
            WeaponFireResult singleShot = singleStep.Fire();
            WeaponFireResult splitShot = splitSteps.Fire();
            singleStep.ReleaseReservation(singleShot.Execution.ReservationToken);
            splitSteps.ReleaseReservation(splitShot.Execution.ReservationToken);

            singleStep.Update(plan.Stats.CycleTime, plan.WeaponKey);
            Assert.That(singleStep.GetTelemetry().Energy, Is.Zero,
                "The cycle boundary itself cannot include post-cycle recharge time.");

            singleStep.Update(0.9d, plan.WeaponKey);
            for (int frame = 0; frame < 90; frame += 1)
            {
                splitSteps.Update((plan.Stats.CycleTime + 0.9d) / 90d, plan.WeaponKey);
            }

            Assert.That(
                singleStep.GetTelemetry().Energy,
                Is.EqualTo(splitSteps.GetTelemetry().Energy).Within(1e-10));
        }

        [TestCase(30)]
        [TestCase(60)]
        [TestCase(120)]
        public void BatteryScheduleIsFrameRateStable(int hertz)
        {
            CompiledBusterPlan plan = BusterTestPlans.Pulse();
            var runtime = new BusterRuntime(executeShot: _ => true);
            runtime.Equip(plan);
            WeaponFireResult shot = runtime.Fire();
            runtime.ReleaseReservation(shot.Execution.ReservationToken);

            int frames = (int)(0.9d * hertz);
            for (int frame = 0; frame < frames; frame += 1)
            {
                runtime.Update(1d / hertz, plan.WeaponKey);
            }

            double expected = 4d + ((6d / 1.8d) * 0.25d);
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(expected).Within(1e-10));
        }

        [Test]
        public void InactiveRegisteredWeaponsRechargeIndependentlyAtHalfRate()
        {
            CompiledBusterPlan firstPlan = BusterTestPlans.Pulse("build-a");
            CompiledBusterPlan secondPlan = BusterTestPlans.Pulse("build-b");
            var runtime = new BusterRuntime(executeShot: _ => true);

            runtime.Equip(firstPlan);
            WeaponFireResult first = runtime.Fire();
            runtime.ReleaseReservation(first.Execution.ReservationToken);
            runtime.Equip(secondPlan);
            WeaponFireResult second = runtime.Fire();
            runtime.ReleaseReservation(second.Execution.ReservationToken);

            runtime.Update(1.65d, secondPlan.WeaponKey);

            Assert.That(
                runtime.GetTelemetry(firstPlan.WeaponKey).Energy,
                Is.EqualTo(4d + ((6d / 1.8d) * 0.5d)).Within(1e-12));
            Assert.That(runtime.GetTelemetry(secondPlan.WeaponKey).Energy, Is.EqualTo(6d));
        }

        [Test]
        public void FailedEnergyRequestDoesNotRestartDelayAndLocksUntilFull()
        {
            CompiledBusterPlan plan = BusterTestPlans.PulseSpreadExplosion();
            var runtime = new BusterRuntime(executeShot: _ => true);
            runtime.Equip(plan);
            WeaponFireResult shot = runtime.Fire();
            runtime.ReleaseReservation(shot.Execution.ReservationToken);

            runtime.Update(plan.Stats.CycleTime, plan.WeaponKey);
            double delayBeforeRequest = runtime.GetTelemetry().RechargeDelayRemaining;
            WeaponFireRequest request = runtime.RequestFire();

            Assert.That(request.Ok, Is.False);
            Assert.That(request.Reason, Is.EqualTo(WeaponFireBlockReasons.Energy));
            Assert.That(request.RecoveryLocked, Is.True);
            Assert.That(runtime.GetTelemetry().RechargeDelayRemaining, Is.EqualTo(delayBeforeRequest));

            runtime.Update(delayBeforeRequest + 0.65d, plan.WeaponKey);
            Assert.That(runtime.GetTelemetry().Energy, Is.GreaterThanOrEqualTo(plan.Stats.EnergyCost));
            Assert.That(runtime.CanFire(), Is.False);
            Assert.That(runtime.GetTelemetry().BlockReason, Is.EqualTo(WeaponFireBlockReasons.Recovery));

            runtime.Update(1.2d, plan.WeaponKey);
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(plan.Stats.MaxEnergy));
            Assert.That(runtime.GetTelemetry().RecoveryLocked, Is.False);
            Assert.That(runtime.CanFire(), Is.True);
        }

        [Test]
        public void ProjectileReservationIsAtomicAndHasPriorityOverEnergyFailure()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();
            var runtime = new BusterRuntime(projectileCapacity: 5, executeShot: _ => true);
            runtime.Equip(plan);

            WeaponFireResult first = runtime.Fire();
            Assert.That(first.Ok, Is.True);
            Assert.That(first.Execution.ReservedProjectileCount, Is.EqualTo(5));
            Assert.That(runtime.ReservedProjectileCount, Is.EqualTo(5));

            runtime.Update(plan.Stats.CycleTime + 0.1d, plan.WeaponKey);
            double energyBefore = runtime.GetTelemetry().Energy;
            WeaponFireResult second = runtime.Fire();

            Assert.That(second.Ok, Is.False);
            Assert.That(second.Reason, Is.EqualTo(WeaponFireBlockReasons.ProjectileCap));
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(energyBefore));
            Assert.That(runtime.GetTelemetry().RecoveryLocked, Is.False);
            Assert.That(runtime.ReleaseReservation(first.Execution.ReservationToken), Is.True);
            Assert.That(runtime.ReleaseReservation(first.Execution.ReservationToken), Is.False);
            Assert.That(runtime.ReservedProjectileCount, Is.Zero);
        }

        [Test]
        public void ExecuteCallbackCannotReenterBeforeFirstShotCommits()
        {
            WeaponFireResult nested = null;
            BusterRuntime runtime = null;
            runtime = new BusterRuntime(executeShot: _ =>
            {
                nested = runtime.Fire();
                return true;
            });
            runtime.Equip(BusterTestPlans.Pulse());

            WeaponFireResult result = runtime.Fire();

            Assert.That(result.Ok, Is.True);
            Assert.That(nested.Ok, Is.False);
            Assert.That(nested.Reason, Is.EqualTo(WeaponFireBlockReasons.Firing));
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(4d));
        }

        [Test]
        public void SpawnRejectionRollsBatteryCycleDelayAndReservationBack()
        {
            var context = new MarkerContext("rejected");
            var runtime = new BusterRuntime(executeShot: _ => false);
            runtime.Equip(BusterTestPlans.Pulse());

            WeaponFireResult result = runtime.Fire(context);
            WeaponTelemetry telemetry = runtime.GetTelemetry();

            Assert.That(result.Ok, Is.False);
            Assert.That(result.Reason, Is.EqualTo(WeaponFireBlockReasons.SpawnRejected));
            Assert.That(telemetry.Energy, Is.EqualTo(6d));
            Assert.That(telemetry.CycleRemaining, Is.Zero);
            Assert.That(telemetry.RechargeDelayRemaining, Is.Zero);
            Assert.That(runtime.GetBatterySnapshot().LastContext, Is.Null);
            Assert.That(runtime.ReservedProjectileCount, Is.Zero);
        }

        [Test]
        public void ThrownSpawnCallbackRollsBackAndPropagatesOriginalFailure()
        {
            var runtime = new BusterRuntime(executeShot: _ => throw new InvalidOperationException("spawn failed"));
            runtime.Equip(BusterTestPlans.Pulse());

            InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => runtime.Fire());

            Assert.That(error.Message, Is.EqualTo("spawn failed"));
            Assert.That(runtime.GetTelemetry().Energy, Is.EqualTo(6d));
            Assert.That(runtime.GetTelemetry().CycleRemaining, Is.Zero);
            Assert.That(runtime.ReservedProjectileCount, Is.Zero);
        }

        [Test]
        public void ResourceSnapshotRestoresEveryIndependentBatteryAndContext()
        {
            var runtime = new BusterRuntime(executeShot: _ => true);
            CompiledBusterPlan mega = BusterCompiler.CompileMega();
            CompiledBusterPlan custom = BusterTestPlans.Pulse("build-a");
            runtime.Equip(mega);
            WeaponFireResult megaShot = runtime.Fire(new MarkerContext("mega"));
            runtime.ReleaseReservation(megaShot.Execution.ReservationToken);
            runtime.Equip(custom);
            WeaponFireResult customShot = runtime.Fire(new MarkerContext("custom"));
            runtime.ReleaseReservation(customShot.Execution.ReservationToken);
            BusterRuntimeResourceSnapshot before = runtime.CreateResourceSnapshot();

            CompiledBusterPlan temporary = BusterTestPlans.Pulse("test:build-a:2");
            runtime.Equip(temporary);
            runtime.Update(2d);
            runtime.ResetWeapon(temporary.WeaponKey, remove: true);
            Assert.That(runtime.RestoreResourceSnapshot(before), Is.True);

            Assert.That(runtime.ActiveWeaponKey, Is.EqualTo(custom.WeaponKey));
            Assert.That(runtime.GetTelemetry(mega.WeaponKey).Energy, Is.EqualTo(4d));
            Assert.That(runtime.GetTelemetry(custom.WeaponKey).Energy, Is.EqualTo(4d));
            Assert.That(
                ((MarkerContext)runtime.GetBatterySnapshot(custom.WeaponKey).LastContext).Marker,
                Is.EqualTo("custom"));
        }

        [Test]
        public void NewRevisionAffectsFutureShotsWithoutCancellingCapturedExecutions()
        {
            CompiledBusterPlan revisionOne = BusterTestPlans.Pulse("build-a", revision: 1);
            CompiledBusterPlan revisionTwo = BusterTestPlans.Pulse("build-a", revision: 2);
            var cancellations = new List<WeaponExecutionCancellation>();
            var runtime = new BusterRuntime(
                executeShot: _ => true,
                cancelExecution: cancellation => cancellations.Add(cancellation));
            runtime.Equip(revisionOne);
            WeaponFireResult first = runtime.Fire(new MarkerContext("old"));

            runtime.Register(revisionTwo);
            Assert.That(cancellations, Is.Empty);
            Assert.That(runtime.ReservedProjectileCount, Is.EqualTo(1));
            Assert.That(first.Execution.Plan, Is.SameAs(revisionOne));
            Assert.That(first.Execution.BuildRevision, Is.EqualTo(1));

            runtime.Update(revisionOne.Stats.CycleTime, revisionOne.WeaponKey);
            WeaponFireResult second = runtime.Fire(new MarkerContext("new"));
            Assert.That(second.Ok, Is.True);
            Assert.That(second.Execution.Plan, Is.SameAs(revisionTwo));
            Assert.That(second.Execution.BuildRevision, Is.EqualTo(2));
            runtime.ReleaseReservation(first.Execution.ReservationToken);
            runtime.ReleaseReservation(second.Execution.ReservationToken);
        }

        [Test]
        public void UnregisterCanPreserveOrExplicitlyCancelInFlightReservations()
        {
            var cancellations = new List<WeaponExecutionCancellation>();
            var runtime = new BusterRuntime(
                executeShot: _ => true,
                cancelExecution: cancellation => cancellations.Add(cancellation));
            CompiledBusterPlan plan = BusterTestPlans.Pulse();
            runtime.Equip(plan);
            WeaponFireResult preserved = runtime.Fire();

            Assert.That(runtime.Unregister(plan.WeaponKey), Is.True);
            Assert.That(runtime.GetTelemetry(plan.WeaponKey), Is.Null);
            Assert.That(runtime.ReservedProjectileCount, Is.EqualTo(1));
            Assert.That(cancellations, Is.Empty);
            runtime.ReleaseReservation(preserved.Execution.ReservationToken);

            runtime.Equip(plan);
            WeaponFireResult cancelled = runtime.Fire();
            Assert.That(runtime.Unregister(
                plan.WeaponKey,
                cancelExecutions: true,
                reason: "invalidated"), Is.True);
            Assert.That(runtime.ReservedProjectileCount, Is.Zero);
            Assert.That(cancellations.Count, Is.EqualTo(1));
            Assert.That(cancellations[0].ReservationToken, Is.EqualTo(cancelled.Execution.ReservationToken));
            Assert.That(cancellations[0].Reason, Is.EqualTo("invalidated"));
        }

        [Test]
        public void CancelBuildReleasesEveryReservationInStableCreationOrder()
        {
            var cancellations = new List<WeaponExecutionCancellation>();
            var runtime = new BusterRuntime(
                executeShot: _ => true,
                cancelExecution: cancellation => cancellations.Add(cancellation));
            CompiledBusterPlan plan = BusterTestPlans.Pulse();
            runtime.Equip(plan);
            WeaponFireResult first = runtime.Fire();
            runtime.Update(plan.Stats.CycleTime, plan.WeaponKey);
            WeaponFireResult second = runtime.Fire();

            Assert.That(runtime.CancelBuild(plan.WeaponKey, "scene-teardown"), Is.EqualTo(2));
            Assert.That(runtime.ReservedProjectileCount, Is.Zero);
            Assert.That(cancellations.ConvertAll(entry => entry.ReservationToken),
                Is.EqualTo(new[] { first.Execution.ReservationToken, second.Execution.ReservationToken }));
            Assert.That(cancellations.TrueForAll(entry => entry.Reason == "scene-teardown"), Is.True);
        }

        [Test]
        public void TelemetryExposesShotCountRevisionAndHudStatusCodes()
        {
            CompiledBusterPlan plan = BusterTestPlans.Pulse("hud-build", revision: 8);
            var runtime = new BusterRuntime(executeShot: _ => true);
            runtime.Equip(plan);

            WeaponTelemetry ready = runtime.GetTelemetry();
            Assert.That(ready.BuildRevision, Is.EqualTo(8));
            Assert.That(ready.ShotsRemaining, Is.EqualTo(3));
            Assert.That(ready.Status, Is.EqualTo("READY"));

            WeaponFireResult shot = runtime.Fire();
            WeaponTelemetry cycling = runtime.GetTelemetry();
            Assert.That(cycling.ShotsRemaining, Is.EqualTo(2));
            Assert.That(cycling.Status, Is.EqualTo("CYCLE"));
            Assert.That(cycling.ReservedProjectiles, Is.EqualTo(1));
            Assert.That(cycling.ProjectileCapacity, Is.EqualTo(24));
            runtime.ReleaseReservation(shot.Execution.ReservationToken);
        }

        [Test]
        public void InvalidElapsedValuesNeverCorruptBatteryState()
        {
            var runtime = new BusterRuntime(executeShot: _ => true);
            CompiledBusterPlan plan = BusterTestPlans.Pulse();
            runtime.Equip(plan);
            WeaponFireResult shot = runtime.Fire();
            runtime.ReleaseReservation(shot.Execution.ReservationToken);
            WeaponTelemetry before = runtime.GetTelemetry();

            runtime.Update(double.NaN);
            runtime.Update(double.PositiveInfinity);
            runtime.Update(-10d);

            WeaponTelemetry after = runtime.GetTelemetry();
            Assert.That(after.Energy, Is.EqualTo(before.Energy));
            Assert.That(after.CycleRemaining, Is.EqualTo(before.CycleRemaining));
            Assert.That(after.RechargeDelayRemaining, Is.EqualTo(before.RechargeDelayRemaining));
        }

        private static void AssertTelemetry(
            WeaponTelemetry telemetry,
            double energy,
            double cycleRemaining,
            double rechargeDelayRemaining,
            bool ready,
            string blockReason,
            int reservedProjectiles)
        {
            Assert.That(telemetry, Is.Not.Null);
            Assert.That(telemetry.Energy, Is.EqualTo(energy).Within(1e-12));
            Assert.That(telemetry.CycleRemaining, Is.EqualTo(cycleRemaining).Within(1e-12));
            Assert.That(telemetry.RechargeDelayRemaining, Is.EqualTo(rechargeDelayRemaining).Within(1e-12));
            Assert.That(telemetry.Ready, Is.EqualTo(ready));
            Assert.That(telemetry.BlockReason, Is.EqualTo(blockReason));
            Assert.That(telemetry.ReservedProjectiles, Is.EqualTo(reservedProjectiles));
        }
    }
}
