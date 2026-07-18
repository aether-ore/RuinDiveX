using System;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Buster.Tests
{
    public sealed class BusterCompilerEditModeTests
    {
        [Test]
        public void NeutralMegaBusterMatchesExportedGoldenPlan()
        {
            CompiledBusterPlan plan = BusterCompiler.CompileMega(revision: 9);

            Assert.That(plan.WeaponKey, Is.EqualTo("megaBuster"));
            Assert.That(plan.BuildRevision, Is.EqualTo(9));
            Assert.That(plan.IsMegaBuster, Is.True);
            Assert.That(plan.Stats.BasePower, Is.EqualTo(8d));
            Assert.That(plan.Stats.TunedPower, Is.EqualTo(8d));
            Assert.That(plan.Stats.EffectivePower, Is.EqualTo(8d));
            Assert.That(plan.Stats.PerChildPower, Is.EqualTo(8d));
            Assert.That(plan.Stats.MaxEnergy, Is.EqualTo(6d));
            Assert.That(plan.Stats.EnergyCost, Is.EqualTo(2d));
            Assert.That(plan.Stats.CycleTime, Is.EqualTo(1d / 4.2d).Within(1e-12));
            Assert.That(plan.Stats.RootRange, Is.EqualTo(6.9d).Within(1e-12));
            Assert.That(plan.Stats.ChildRange, Is.EqualTo(4.485d).Within(1e-12));
            Assert.That(plan.Stats.ProjectileCount, Is.EqualTo(1));
            Assert.That(plan.Stats.ShotsPerCharge, Is.EqualTo(3));
            Assert.That(plan.Stats.Stagger, Is.EqualTo(0.08d).Within(1e-12));
            Assert.That(plan.PeakProjectileReservation, Is.EqualTo(1));
            Assert.That(plan.Actions.Select(action => action.ActionId), Is.EqualTo(new[] { "emit-root" }));
            Assert.That(
                plan.Description,
                Is.EqualTo("Fixed Mega Buster Pulse. 3 shots per battery; weapon-local PWR / ENG / RNG / RPD."));
        }

        [Test]
        public void ApexClusterExplosionMatchesExportedGoldenPlan()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();

            Assert.That(plan.BuildRevision, Is.EqualTo(7));
            Assert.That(plan.Stats.TunedPower, Is.EqualTo(17.1d).Within(1e-12));
            Assert.That(plan.Stats.EffectivePower, Is.EqualTo(20.52d).Within(1e-12));
            Assert.That(plan.Stats.RawEffectivePower, Is.EqualTo(20.52d).Within(1e-12));
            Assert.That(plan.Stats.PerChildPower, Is.EqualTo(4.104d).Within(1e-12));
            Assert.That(plan.Stats.CarrierPower, Is.Zero.Within(1e-12));
            Assert.That(plan.Stats.MaxEnergy, Is.EqualTo(6d));
            Assert.That(plan.Stats.EnergyCost, Is.EqualTo(6d));
            Assert.That(plan.Stats.CycleTime, Is.EqualTo(1.275016362786349d).Within(1e-12));
            Assert.That(plan.Stats.FinalRapid, Is.EqualTo(0.784303660083747d).Within(1e-12));
            Assert.That(plan.Stats.RootRange, Is.EqualTo(5.766d).Within(1e-12));
            Assert.That(plan.Stats.ChildRange, Is.EqualTo(3.7479d).Within(1e-12));
            Assert.That(plan.Stats.ProjectileCount, Is.EqualTo(5));
            Assert.That(plan.Stats.ShotsPerCharge, Is.EqualTo(1));
            Assert.That(plan.Stats.Stagger, Is.EqualTo(0.06156d).Within(1e-12));
            Assert.That(plan.PeakProjectileReservation, Is.EqualTo(5));
            Assert.That(plan.Stats.ProgramCapacityUsed, Is.EqualTo(4));
            Assert.That(plan.Actions.Select(action => action.ActionId),
                Is.EqualTo(new[] { "emit-carrier", "trigger-child", "emit-child" }));
        }

        [Test]
        public void PacketAllocationConservesEffectivePower()
        {
            CompiledBusterPlan plan = BusterTestPlans.ApexClusterExplosion();

            Assert.That(plan.CarrierPacket, Is.Not.Null);
            Assert.That(plan.ChildPacket, Is.Not.Null);
            Assert.That(
                plan.CarrierPacket.DamagePower + plan.ChildPacket.TotalPower,
                Is.EqualTo(plan.Stats.EffectivePower).Within(1e-12));
            Assert.That(
                plan.ChildPacket.Count * plan.ChildPacket.Power,
                Is.EqualTo(plan.ChildPacket.TotalPower).Within(1e-12));
            Assert.That(plan.Payload.Type, Is.EqualTo("explosion"));
            Assert.That(plan.Payload.ReplacesDirect, Is.True);
        }

        [Test]
        public void CompilationCapturesSourceRevisionWithoutMutableAliases()
        {
            CompiledBusterPlan first = BusterTestPlans.Pulse("same-build", revision: 4);
            CompiledBusterPlan second = BusterTestPlans.Pulse("same-build", revision: 5);

            Assert.That(first.BuildRevision, Is.EqualTo(4));
            Assert.That(second.BuildRevision, Is.EqualTo(5));
            Assert.That(first, Is.Not.SameAs(second));
            Assert.That(first.SourceBuild, Is.Not.SameAs(second.SourceBuild));
            Assert.That(first.Actions, Is.Not.SameAs(second.Actions));
            Assert.That(first.Actions[0].Power, Is.EqualTo(second.Actions[0].Power));
        }

        [Test]
        public void InvalidGraphReturnsStructuredErrorsAndCannotCompile()
        {
            var source = new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                "invalid-cycle",
                "test-chassis",
                new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource(
                    "pulse",
                    new[]
                    {
                        new BusterNodeSource("pulse", "pulseBolt", "pulse-instance"),
                        new BusterNodeSource("spread", "spread3", "spread-instance")
                    },
                    new[]
                    {
                        new BusterEdgeSource("pulse", BusterEdgePorts.Next, "spread"),
                        new BusterEdgeSource("spread", BusterEdgePorts.Next, "pulse")
                    }));

            BusterValidationResult validation = BusterValidator.ValidateProgram(source);
            Assert.That(validation.IsValid, Is.False);
            Assert.That(validation.Errors.Any(issue => issue.Code == "CYCLE"), Is.True);
            Assert.That(validation.Errors.Any(issue => issue.Code == "ROOT_HAS_INCOMING_EDGE"), Is.True);

            BusterCompileException error = Assert.Throws<BusterCompileException>(() => BusterCompiler.Compile(source));
            Assert.That(error.Code, Is.EqualTo("BUSTER_COMPILE_FAILED"));
            Assert.That(error.Errors.Any(issue => issue.Code == "CYCLE"), Is.True);
        }

        [Test]
        public void BuildValidationRejectsUnownedAndAlreadyClaimedPhysicalModules()
        {
            BusterBuildSource source = BusterTestPlans.Pulse("owned-check").SourceBuild;
            string instanceId = source.Program.Nodes[0].ModuleInstanceId;
            var context = new BusterValidationContext(
                Array.Empty<string>(),
                new[] { instanceId });

            BusterValidationResult result = BusterValidator.ValidateBuild(source, context);

            Assert.That(result.IsValid, Is.False);
            Assert.That(result.Errors.Any(issue => issue.Code == "INSTANCE_NOT_OWNED"), Is.True);
            Assert.That(result.Errors.Any(issue => issue.Code == "INSTANCE_ALREADY_CLAIMED"), Is.True);
        }

        [Test]
        public void NormalizationUsesStableOrdinalNodeAndPortOrdering()
        {
            var source = new BusterBuildSource(
                BusterRuleset.SchemaVersion,
                BusterRuleset.RulesetVersion,
                "normalized",
                "test-chassis",
                new BusterTuning(4, 4, 4, 4),
                new BusterProgramSource(
                    "b",
                    new[]
                    {
                        new BusterNodeSource("z", "pulsePayload"),
                        new BusterNodeSource("b", "pulseBolt", "emitter"),
                        new BusterNodeSource("c", "onImpact"),
                        new BusterNodeSource("d", "pulsePayload")
                    },
                    new[]
                    {
                        new BusterEdgeSource("c", BusterEdgePorts.Child, "d"),
                        new BusterEdgeSource("b", BusterEdgePorts.Next, "c")
                    }),
                revision: 12);

            BusterBuildSource normalized = BusterBuildSource.Normalize(source);

            Assert.That(normalized.Program.Nodes.Select(node => node.NodeId),
                Is.EqualTo(new[] { "b", "c", "d", "z" }));
            Assert.That(normalized.Program.Edges.Select(edge => edge.Port),
                Is.EqualTo(new[] { BusterEdgePorts.Next, BusterEdgePorts.Child }));
            Assert.That(normalized.Revision, Is.EqualTo(12));
        }
    }
}
