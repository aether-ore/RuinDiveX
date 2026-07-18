using System;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Stable ordinal identifier for a targetable body or part. Default is an
    /// invalid sentinel and cannot be registered.
    /// </summary>
    public readonly struct CombatTargetId : IEquatable<CombatTargetId>, IComparable<CombatTargetId>
    {
        public string Value { get; }
        public bool IsEmpty => string.IsNullOrEmpty(Value);

        public CombatTargetId(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("Combat target id cannot be empty.", nameof(value));
            }

            Value = value.Trim();
        }

        public static bool TryCreate(string value, out CombatTargetId id)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                id = default;
                return false;
            }

            id = new CombatTargetId(value);
            return true;
        }

        public int CompareTo(CombatTargetId other)
        {
            return string.Compare(Value, other.Value, StringComparison.Ordinal);
        }

        public bool Equals(CombatTargetId other)
        {
            return string.Equals(Value, other.Value, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is CombatTargetId other && Equals(other);
        }

        public override int GetHashCode()
        {
            return Value == null ? 0 : StringComparer.Ordinal.GetHashCode(Value);
        }

        public override string ToString()
        {
            return Value ?? string.Empty;
        }

        public static bool operator ==(CombatTargetId left, CombatTargetId right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(CombatTargetId left, CombatTargetId right)
        {
            return !left.Equals(right);
        }
    }
}
