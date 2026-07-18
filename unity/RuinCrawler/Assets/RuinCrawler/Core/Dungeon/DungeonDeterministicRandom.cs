using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Dungeon
{
    /// <summary>
    /// String-seeded FNV-1a plus Mulberry32 kernel used by the live deterministic
    /// generation code. All dungeon choices flow through this instance.
    /// </summary>
    public sealed class DungeonDeterministicRandom
    {
        private const uint DefaultNonZeroState = 0x6d2b79f5u;
        private const double Uint32Range = 4294967296d;

        public DungeonDeterministicRandom(string seed)
        {
            Seed = HashSeed(seed ?? "dungeon");
            State = Seed == 0u ? DefaultNonZeroState : Seed;
        }

        public uint Seed { get; }
        public uint State { get; private set; }

        public static uint HashSeed(string value)
        {
            string text = value ?? "dungeon";
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

        public bool Chance(double probability)
        {
            return NextDouble() < probability;
        }

        public int RangeInclusive(int minimum, int maximum)
        {
            int lower = Math.Min(minimum, maximum);
            int upper = Math.Max(minimum, maximum);
            return lower + (int)Math.Floor(NextDouble() * (upper - lower + 1d));
        }

        public T Pick<T>(IReadOnlyList<T> values)
        {
            if (values == null || values.Count == 0)
            {
                return default;
            }

            int index = (int)Math.Floor(NextDouble() * values.Count);
            return values[Math.Min(values.Count - 1, index)];
        }
    }
}
