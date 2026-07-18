using System;
using System.Linq;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class IndustrialFactoryV2GenerationAttemptTests
    {
        [Test]
        public void DefaultGenerationUsesOneBasedDeterministicAttemptIdentity()
        {
            var generator = new IndustrialFactoryV2Generator();
            IndustrialFactoryV2GenerationResult first = generator.GenerateResult("attempt-identity");
            IndustrialFactoryV2GenerationResult second = generator.GenerateResult("attempt-identity");

            Assert.That(first.Succeeded, Is.True, Describe(first));
            Assert.That(second.Succeeded, Is.True, Describe(second));
            Assert.That(first.AttemptCount, Is.EqualTo(1));
            Assert.That(first.Attempts[0].CandidateCount, Is.EqualTo(1));
            Assert.That(first.Attempts[0].BacktrackCount, Is.Zero);
            Assert.That(first.Plan.GenerationAttempt, Is.EqualTo(0));
            Assert.That(first.Plan.AttemptSeed, Is.EqualTo("attempt-identity:attempt:1"));
            Assert.That(second.Plan.DeterministicSignature, Is.EqualTo(first.Plan.DeterministicSignature));
        }

        [Test]
        public void RejectedCandidateBacktracksWithinAttemptBeforeAdvancingAttempt()
        {
            var rejecting = new RejectFirstThenValidate();
            var generator = new IndustrialFactoryV2Generator(rejecting);
            IndustrialFactoryV2GenerationResult result = generator.GenerateResult(
                "backtrack-before-attempt",
                new IndustrialFactoryV2GenerationOptions(maximumAttempts: 2));

            Assert.That(result.Succeeded, Is.True, Describe(result));
            Assert.That(result.AttemptCount, Is.EqualTo(1));
            Assert.That(result.Attempts[0].CandidateCount, Is.EqualTo(2));
            Assert.That(result.Attempts[0].BacktrackCount, Is.EqualTo(1));
            Assert.That(rejecting.CallCount, Is.EqualTo(2));
        }

        [Test]
        public void ExhaustionReturnsStructuredTwelveAttemptFailure()
        {
            var generator = new IndustrialFactoryV2Generator(new AlwaysReject());
            IndustrialFactoryV2GenerationResult result = generator.GenerateResult(
                "structured-attempt-failure",
                new IndustrialFactoryV2GenerationOptions(
                    maximumAttempts: IndustrialFactoryV2Ruleset.MaximumGenerationAttempts,
                    maximumBacktracksPerAttempt: 0));

            Assert.That(result.Succeeded, Is.False);
            Assert.That(result.Plan, Is.Null);
            Assert.That(result.AttemptCount, Is.EqualTo(IndustrialFactoryV2Ruleset.MaximumGenerationAttempts));
            Assert.That(result.Failure.Code, Is.EqualTo(IndustrialFactoryV2GenerationFailure.AttemptsExhaustedCode));
            Assert.That(result.Failure.Attempts, Is.EqualTo(IndustrialFactoryV2Ruleset.MaximumGenerationAttempts));
            Assert.That(result.Failure.LastErrors.Select(value => value.Code), Does.Contain("INJECTED_REJECTION"));
            Assert.That(result.Attempts.All(value => value.CandidateCount == 1), Is.True);
            Assert.That(result.Attempts.All(value => value.BacktrackCount == 0), Is.True);
            Assert.That(
                result.Attempts.Select(value => value.AttemptSeed),
                Is.EqualTo(Enumerable.Range(1, 12).Select(value => "structured-attempt-failure:attempt:" + value)));
        }

        [Test]
        public void ConservativeVolumesContainCertifiedJumpAndReactionRise()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("exposure-rise-envelope");
            double normalRise = Math.Max(
                TraversalProfilesV2.Dry.JumpHeight,
                DungeonReactionEnvelopesV2.PlayerKnockback.MaximumRiseHeight);
            foreach (DungeonFallExposurePlanV2 exposure in plan.FallExposures.Where(value =>
                (value.Causes & DungeonFallExposureCauseV2.Knockback) != 0))
            {
                Assert.That(
                    exposure.ConservativeFallVolume.MaximumY,
                    Is.GreaterThanOrEqualTo(exposure.SourceVolume.MaximumY + normalRise - 1e-9d),
                    exposure.Id);
            }

            DungeonFallExposurePlanV2 moving = plan.FallExposures.Single(value =>
                value.Id == "exposure-reservoir-moving-platform");
            Assert.That(
                moving.ConservativeFallVolume.MaximumY,
                Is.GreaterThanOrEqualTo(
                    moving.SourceVolume.MaximumY + TraversalProfilesV2.Flooded.JumpHeight - 1e-9d));
        }

        [Test]
        public void StationaryCrumbleFootprintOverlapsSafeCatchmentByCapsuleMargin()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("crumble-zero-displacement");
            DungeonFallExposurePlanV2 crumble = plan.FallExposures.Single(value =>
                (value.Causes & DungeonFallExposureCauseV2.Crumble) != 0);
            DungeonFallCatchmentPlanV2 catchment = plan.FallCatchments.Single(value =>
                crumble.RequiredCatchmentIds.Contains(value.Id));

            double overlapX = AxisOverlap(
                crumble.SourceVolume.HorizontalVertices.Min(value => value.X),
                crumble.SourceVolume.HorizontalVertices.Max(value => value.X),
                catchment.Volume.HorizontalVertices.Min(value => value.X),
                catchment.Volume.HorizontalVertices.Max(value => value.X));
            double overlapZ = AxisOverlap(
                crumble.SourceVolume.HorizontalVertices.Min(value => value.Z),
                crumble.SourceVolume.HorizontalVertices.Max(value => value.Z),
                catchment.Volume.HorizontalVertices.Min(value => value.Z),
                catchment.Volume.HorizontalVertices.Max(value => value.Z));
            Assert.That(overlapX, Is.GreaterThanOrEqualTo(DungeonFallCoverageValidatorV2.LandingErosion * 2d));
            Assert.That(overlapZ, Is.GreaterThanOrEqualTo(DungeonFallCoverageValidatorV2.LandingErosion * 2d));
        }

        private static double AxisOverlap(double aMinimum, double aMaximum, double bMinimum, double bMaximum)
        {
            return Math.Max(0d, Math.Min(aMaximum, bMaximum) - Math.Max(aMinimum, bMinimum));
        }

        private static string Describe(IndustrialFactoryV2GenerationResult result)
        {
            return result.Failure == null
                ? string.Empty
                : string.Join(" | ", result.Failure.LastErrors.Select(value => value.ToString()));
        }

        private sealed class RejectFirstThenValidate : IIndustrialFactoryV2CandidateValidator
        {
            private readonly IndustrialFactoryV2Validator inner = new IndustrialFactoryV2Validator();

            public int CallCount { get; private set; }

            public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan)
            {
                CallCount += 1;
                return CallCount == 1
                    ? Rejected()
                    : inner.Validate(plan);
            }
        }

        private sealed class AlwaysReject : IIndustrialFactoryV2CandidateValidator
        {
            public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan) => Rejected();
        }

        private static IndustrialFactoryV2ValidationResult Rejected()
        {
            return new IndustrialFactoryV2ValidationResult(new[]
            {
                new IndustrialFactoryV2ValidationIssue(
                    "INJECTED_REJECTION",
                    "/generation/test",
                    "Injected candidate rejection exercises deterministic bounded backtracking.")
            });
        }
    }
}
