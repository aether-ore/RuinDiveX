using NUnit.Framework;
using RuinCrawler.Port.Determinism;

namespace RuinCrawler.Port.Tests
{
    public sealed class SeededRandomTests
    {
        [TestCase("reaverbot", 2848495183u)]
        [TestCase("unity-port-smoke", 655745335u)]
        [TestCase("room:42", 4250311129u)]
        public void HashSeedMatchesThreeJsReference(string seed, uint expected)
        {
            Assert.That(SeededRandom.HashSeed(seed), Is.EqualTo(expected));
        }

        [Test]
        public void SequenceMatchesThreeJsReference()
        {
            var random = new SeededRandom("unity-port-smoke");
            double[] expected =
            {
                0.15289762802422047,
                0.4341005354654044,
                0.5611107049044222,
                0.6637288010679185,
                0.9760620282031596
            };

            foreach (double value in expected)
            {
                Assert.That(random.NextDouble(), Is.EqualTo(value).Within(1e-12));
            }
        }

        [Test]
        public void SameSeedProducesSameSequence()
        {
            var first = new SeededRandom("same-seed");
            var second = new SeededRandom("same-seed");

            for (int index = 0; index < 64; index += 1)
            {
                Assert.That(first.NextDouble(), Is.EqualTo(second.NextDouble()));
            }
        }
    }
}
