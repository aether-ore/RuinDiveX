namespace RuinCrawler.Core.Foundation
{
    public enum HealthChangeKind
    {
        Damage = 0,
        Heal = 1,
        Reset = 2,
        MaximumChanged = 3
    }

    public readonly struct HealthChange
    {
        public HealthChangeKind Kind { get; }
        public HealthSnapshot Previous { get; }
        public HealthSnapshot Current { get; }

        public HealthChange(HealthChangeKind kind, HealthSnapshot previous, HealthSnapshot current)
        {
            Kind = kind;
            Previous = previous;
            Current = current;
        }
    }
}
