using System;
using System.Collections.Generic;
using System.Globalization;

namespace RuinCrawler.Core.Reaverbots
{
    /// <summary>
    /// Bit-for-bit string-seed FNV avalanche and Mulberry32 port from
    /// src/reaverbots/SeededRandom.js. It lives in Core because Core cannot
    /// reference the legacy Runtime assembly that currently contains the
    /// prototype copy of this kernel.
    /// </summary>
    public sealed class ReaverbotSeededRandom
    {
        private const uint DefaultNonZeroState = 0x6d2b79f5u;
        private const double Uint32Range = 4294967296d;

        public ReaverbotSeededRandom(string seed = "reaverbot")
        {
            Seed = ReaverbotDeterminism.HashSeed(seed);
            State = Seed == 0u ? DefaultNonZeroState : Seed;
        }

        public uint Seed { get; }
        public uint State { get; private set; }

        public double NextDouble()
        {
            uint value;
            unchecked
            {
                State += DefaultNonZeroState;
                value = State;
                value = (value ^ (value >> 15)) * (value | 1u);
                value ^= value + ((value ^ (value >> 7)) * (value | 61u));
                value ^= value >> 14;
            }

            return value / Uint32Range;
        }

        public double Range(double minimum = 0d, double maximum = 1d)
        {
            return minimum + ((maximum - minimum) * NextDouble());
        }

        public int RangeInclusive(int minimum, int maximum)
        {
            int lower = Math.Min(minimum, maximum);
            int upper = Math.Max(minimum, maximum);
            return lower + (int)Math.Floor(NextDouble() * ((upper - lower) + 1d));
        }

        public bool Chance(double probability)
        {
            return NextDouble() < probability;
        }

        public T Pick<T>(IReadOnlyList<T> values)
        {
            if (values == null || values.Count == 0)
            {
                return default;
            }

            return values[(int)Math.Floor(NextDouble() * values.Count)];
        }

        public string Weighted(IReadOnlyList<ReaverbotWeightedId> entries, string fallback = null)
        {
            if (entries == null || entries.Count == 0)
            {
                return fallback;
            }

            double total = 0d;
            for (int index = 0; index < entries.Count; index += 1)
            {
                double weight = entries[index]?.Weight ?? 0d;
                if (!double.IsNaN(weight) && !double.IsInfinity(weight) && weight > 0d)
                {
                    total += weight;
                }
            }

            if (total <= 0d)
            {
                return fallback;
            }

            double roll = NextDouble() * total;
            string last = fallback;
            for (int index = 0; index < entries.Count; index += 1)
            {
                ReaverbotWeightedId entry = entries[index];
                double weight = entry?.Weight ?? 0d;
                if (double.IsNaN(weight) || double.IsInfinity(weight) || weight <= 0d)
                {
                    continue;
                }

                last = entry.Id;
                roll -= weight;
                if (roll <= 0d)
                {
                    return entry.Id;
                }
            }

            return last;
        }

        public ReaverbotSeededRandom Fork(string label)
        {
            return new ReaverbotSeededRandom(
                Seed.ToString(CultureInfo.InvariantCulture)
                + ":"
                + (label ?? string.Empty));
        }
    }

    public static class ReaverbotDeterminism
    {
        public static uint HashSeed(string value)
        {
            string text = value ?? "reaverbot";
            uint hash = 0x811c9dc5u;

            unchecked
            {
                for (int index = 0; index < text.Length; index += 1)
                {
                    hash ^= text[index];
                    hash *= 0x01000193u;
                }

                hash += hash << 13;
                hash ^= hash >> 7;
                hash += hash << 3;
                hash ^= hash >> 17;
                hash += hash << 5;
            }

            return hash;
        }

        public static uint HashSeed(uint value)
        {
            return HashSeed(value.ToString(CultureInfo.InvariantCulture));
        }

        public static uint CreateEncounterSlotSeed(
            string runSeed,
            string encounterId,
            int slotIndex)
        {
            return HashSeed(
                (runSeed ?? string.Empty)
                + ":encounter:"
                + (encounterId ?? string.Empty)
                + ":slot:"
                + slotIndex.ToString(CultureInfo.InvariantCulture));
        }
    }
}
