using System;
using System.Collections.Generic;

namespace RuinCrawler.Port.Determinism
{
    /// <summary>
    /// Bit-for-bit port of src/reaverbots/SeededRandom.js for string seeds.
    /// Keep this numeric kernel shared by Unity generation and simulation.
    /// </summary>
    public sealed class SeededRandom
    {
        private const uint DefaultNonZeroState = 0x6d2b79f5u;
        private const double Uint32Range = 4294967296.0;

        public uint Seed { get; }
        public uint State { get; private set; }

        public SeededRandom(string seed = "reaverbot")
        {
            Seed = HashSeed(seed ?? "reaverbot");
            State = Seed == 0 ? DefaultNonZeroState : Seed;
        }

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

        public float Range(float minimum = 0f, float maximum = 1f)
        {
            return minimum + (maximum - minimum) * (float)NextDouble();
        }

        public int RangeInclusive(int minimum, int maximum)
        {
            int lower = Math.Min(minimum, maximum);
            int upper = Math.Max(minimum, maximum);
            return lower + (int)Math.Floor(NextDouble() * (upper - lower + 1d));
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

        public SeededRandom Fork(string label)
        {
            return new SeededRandom($"{Seed}:{label ?? string.Empty}");
        }
    }
}
