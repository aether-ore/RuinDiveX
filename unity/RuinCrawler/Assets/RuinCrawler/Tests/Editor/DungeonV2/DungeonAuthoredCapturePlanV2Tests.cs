using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Editor.DungeonV2.Tests
{
    public sealed class DungeonAuthoredCapturePlanV2Tests
    {
        [Test]
        public void BuildCreatesSeventyTwoModuleViewsAndSevenRepresentativeViews()
        {
            IReadOnlyList<DungeonAuthoredCaptureRequestV2> requests =
                DungeonAuthoredCapturePlanV2.Build(BuildSources());

            Assert.That(requests, Has.Count.EqualTo(79));
            Assert.That(
                requests.Select(value => value.RelativePath).Distinct(StringComparer.Ordinal).Count(),
                Is.EqualTo(79));
            Assert.That(requests.Count(value => value.RelativePath.StartsWith("modules/", StringComparison.Ordinal)),
                Is.EqualTo(72));
            Assert.That(requests.Count(value => value.RelativePath.StartsWith("representative/", StringComparison.Ordinal)),
                Is.EqualTo(7));
            CollectionAssert.AreEquivalent(
                new[] { "ground", "upper", "lower" },
                requests.Where(value => value.TemplateId == "module-00")
                    .Where(value => value.RelativePath.StartsWith("modules/", StringComparison.Ordinal))
                    .Select(value => value.ViewId));
            CollectionAssert.AreEquivalent(
                new[] { "bright", "dark", "waterworks-cyan", "hazard-magma",
                    "electric-safe", "electric-charge", "electric-live" },
                requests.Where(value => value.RelativePath.StartsWith("representative/", StringComparison.Ordinal))
                    .Select(value => value.ViewId));
        }

        [Test]
        public void BuildRejectsIncompleteOrDuplicateLibraries()
        {
            Assert.Throws<InvalidOperationException>(() =>
                DungeonAuthoredCapturePlanV2.Build(BuildSources().Take(23)));

            List<DungeonAuthoredCaptureSourceV2> duplicate = BuildSources().ToList();
            duplicate[23] = new DungeonAuthoredCaptureSourceV2(
                "module-00", DungeonModuleArchetypeV2.SurveillanceControlTheater, false, false);
            Assert.Throws<InvalidOperationException>(() => DungeonAuthoredCapturePlanV2.Build(duplicate));
        }

        [Test]
        public void ResolveOutputDirectoryUsesDefaultAndSupportsOverride()
        {
            string root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "ruincrawler-capture-plan-test"));
            string expected = Path.GetFullPath(Path.Combine(
                root, "artifacts", "unity-captures", "dungeon-v2-authored"));
            Assert.That(DungeonAuthoredCapturePlanV2.ResolveOutputDirectory(root, Array.Empty<string>()),
                Is.EqualTo(expected));
            Assert.That(DungeonAuthoredCapturePlanV2.ResolveOutputDirectory(
                    root, new[] { "Unity", "-dungeonV2CaptureOutput", "qa/captures" }),
                Is.EqualTo(Path.GetFullPath(Path.Combine(root, "qa", "captures"))));
            Assert.Throws<ArgumentException>(() => DungeonAuthoredCapturePlanV2.ResolveOutputDirectory(
                root, new[] { "-dungeonV2CaptureOutput" }));
        }

        [Test]
        public void SanitizePathSegmentRemovesWhitespaceAndInvalidSeparators()
        {
            string sanitized = DungeonAuthoredCapturePlanV2.SanitizePathSegment(" Hazard / Room:A ");
            Assert.That(sanitized, Does.Not.Contain(" "));
            Assert.That(sanitized, Does.Not.Contain("/"));
            Assert.That(sanitized, Does.Not.Contain(":"));
        }

        private static IEnumerable<DungeonAuthoredCaptureSourceV2> BuildSources()
        {
            for (int index = 0; index < 24; index += 1)
            {
                yield return new DungeonAuthoredCaptureSourceV2(
                    "module-" + index.ToString("00"),
                    (DungeonModuleArchetypeV2)(index / 2),
                    index == 4,
                    index == 20);
            }
        }
    }
}
