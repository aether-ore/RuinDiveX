namespace RuinCrawler.Core.Foundation
{
    public readonly struct HealthHealResult
    {
        public double RequestedAmount { get; }
        public double AppliedAmount { get; }
        public HealthSnapshot Previous { get; }
        public HealthSnapshot Current { get; }

        public HealthHealResult(
            double requestedAmount,
            double appliedAmount,
            HealthSnapshot previous,
            HealthSnapshot current)
        {
            RequestedAmount = requestedAmount;
            AppliedAmount = appliedAmount;
            Previous = previous;
            Current = current;
        }
    }
}
