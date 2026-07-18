using System;

namespace RuinCrawler.Core.Foundation
{
    public readonly struct HealthSnapshot : IEquatable<HealthSnapshot>
    {
        public double Current { get; }
        public double Maximum { get; }
        public bool IsDead => Current <= 0d;
        public double Normalized => Maximum <= 0d ? 0d : Current / Maximum;

        public HealthSnapshot(double current, double maximum)
        {
            DoubleVector3.RequireFinite(current, nameof(current));
            DoubleVector3.RequireFinite(maximum, nameof(maximum));
            if (maximum <= 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(maximum), maximum, "Maximum health must be greater than zero.");
            }

            if (current < 0d || current > maximum)
            {
                throw new ArgumentOutOfRangeException(nameof(current), current, "Current health must be within [0, maximum].");
            }

            Current = current;
            Maximum = maximum;
        }

        public bool Equals(HealthSnapshot other)
        {
            return Current.Equals(other.Current) && Maximum.Equals(other.Maximum);
        }

        public override bool Equals(object obj)
        {
            return obj is HealthSnapshot other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                return (Current.GetHashCode() * 397) ^ Maximum.GetHashCode();
            }
        }

        public static bool operator ==(HealthSnapshot left, HealthSnapshot right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(HealthSnapshot left, HealthSnapshot right)
        {
            return !left.Equals(right);
        }
    }
}
