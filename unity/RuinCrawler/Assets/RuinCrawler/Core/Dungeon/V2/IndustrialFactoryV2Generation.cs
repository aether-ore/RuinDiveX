using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon.V2
{
    public interface IIndustrialFactoryV2CandidateValidator
    {
        IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan);
    }

    public sealed class IndustrialFactoryV2GenerationOptions
    {
        public IndustrialFactoryV2GenerationOptions(
            int difficulty = 1,
            int maximumAttempts = IndustrialFactoryV2Ruleset.MaximumGenerationAttempts,
            int maximumBacktracksPerAttempt = IndustrialFactoryV2Ruleset.MaximumVariantBacktracksPerAttempt)
        {
            Difficulty = Math.Max(1, difficulty);
            MaximumAttempts = Math.Max(
                1,
                Math.Min(IndustrialFactoryV2Ruleset.MaximumGenerationAttempts, maximumAttempts));
            MaximumBacktracksPerAttempt = Math.Max(
                0,
                Math.Min(IndustrialFactoryV2Ruleset.MaximumVariantBacktracksPerAttempt, maximumBacktracksPerAttempt));
        }

        public int Difficulty { get; }
        public int MaximumAttempts { get; }
        public int MaximumBacktracksPerAttempt { get; }
    }

    public sealed class IndustrialFactoryV2GenerationContext
    {
        public IndustrialFactoryV2GenerationContext(
            string seed,
            string attemptSeed,
            int attempt,
            int difficulty)
        {
            Seed = DungeonV2Contract.RequireId(seed, nameof(seed));
            AttemptSeed = DungeonV2Contract.RequireId(attemptSeed, nameof(attemptSeed));
            if (attempt < 1 || attempt > IndustrialFactoryV2Ruleset.MaximumGenerationAttempts)
                throw new ArgumentOutOfRangeException(nameof(attempt));
            if (difficulty < 1) throw new ArgumentOutOfRangeException(nameof(difficulty));
            Attempt = attempt;
            Difficulty = difficulty;
        }

        public string Seed { get; }
        public string AttemptSeed { get; }
        public int Attempt { get; }
        public int Difficulty { get; }
    }

    public sealed class IndustrialFactoryV2GenerationAttemptReport
    {
        public IndustrialFactoryV2GenerationAttemptReport(
            int attempt,
            string attemptSeed,
            int candidateCount,
            int backtrackCount,
            IndustrialFactoryV2ValidationResult validation)
        {
            Attempt = attempt;
            AttemptSeed = DungeonV2Contract.RequireId(attemptSeed, nameof(attemptSeed));
            CandidateCount = Math.Max(0, candidateCount);
            BacktrackCount = Math.Max(0, backtrackCount);
            Validation = validation ?? throw new ArgumentNullException(nameof(validation));
        }

        public int Attempt { get; }
        public string AttemptSeed { get; }
        public int CandidateCount { get; }
        public int BacktrackCount { get; }
        public IndustrialFactoryV2ValidationResult Validation { get; }
    }

    public sealed class IndustrialFactoryV2GenerationFailure
    {
        public const string AttemptsExhaustedCode = "INDUSTRIAL_FACTORY_V2_ATTEMPTS_EXHAUSTED";

        public IndustrialFactoryV2GenerationFailure(
            string seed,
            int attempts,
            IEnumerable<IndustrialFactoryV2ValidationIssue> lastErrors)
        {
            Seed = DungeonV2Contract.RequireId(seed, nameof(seed));
            Attempts = Math.Max(0, attempts);
            LastErrors = DungeonV2Contract.CopyOrdered(lastErrors, nameof(lastErrors));
        }

        public string Code => AttemptsExhaustedCode;
        public string Seed { get; }
        public int Attempts { get; }
        public IReadOnlyList<IndustrialFactoryV2ValidationIssue> LastErrors { get; }
    }

    public sealed class IndustrialFactoryV2GenerationResult
    {
        private IndustrialFactoryV2GenerationResult(
            DungeonPlanV2 plan,
            IndustrialFactoryV2GenerationFailure failure,
            IEnumerable<IndustrialFactoryV2GenerationAttemptReport> attempts)
        {
            Plan = plan;
            Failure = failure;
            Attempts = DungeonV2Contract.CopyOrdered(attempts, nameof(attempts));
        }

        public bool Succeeded => Plan != null && Failure == null;
        public DungeonPlanV2 Plan { get; }
        public IndustrialFactoryV2GenerationFailure Failure { get; }
        public IReadOnlyList<IndustrialFactoryV2GenerationAttemptReport> Attempts { get; }
        public int AttemptCount => Attempts.Count;

        internal static IndustrialFactoryV2GenerationResult Success(
            DungeonPlanV2 plan,
            IEnumerable<IndustrialFactoryV2GenerationAttemptReport> attempts)
        {
            return new IndustrialFactoryV2GenerationResult(
                plan ?? throw new ArgumentNullException(nameof(plan)),
                null,
                attempts);
        }

        internal static IndustrialFactoryV2GenerationResult Failed(
            IndustrialFactoryV2GenerationFailure failure,
            IEnumerable<IndustrialFactoryV2GenerationAttemptReport> attempts)
        {
            return new IndustrialFactoryV2GenerationResult(
                null,
                failure ?? throw new ArgumentNullException(nameof(failure)),
                attempts);
        }
    }
}
