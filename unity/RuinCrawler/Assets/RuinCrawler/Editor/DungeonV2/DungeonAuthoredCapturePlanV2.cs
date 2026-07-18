using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;

namespace RuinCrawler.Editor.DungeonV2
{
    public enum DungeonAuthoredCaptureBandV2 { Ground, Upper, Lower }

    public enum DungeonAuthoredCaptureLightingV2
    {
        Neutral,
        Bright,
        Dark,
        Waterworks,
        Magma,
        ElectricSafe,
        ElectricCharge,
        ElectricLive
    }

    public sealed class DungeonAuthoredCaptureSourceV2
    {
        public DungeonAuthoredCaptureSourceV2(
            string templateId,
            DungeonModuleArchetypeV2 archetype,
            bool containsWaterworks,
            bool containsHazardDistrict)
        {
            if (string.IsNullOrWhiteSpace(templateId))
                throw new ArgumentException("A capture source requires a template ID.", nameof(templateId));
            TemplateId = templateId;
            Archetype = archetype;
            ContainsWaterworks = containsWaterworks;
            ContainsHazardDistrict = containsHazardDistrict;
        }

        public string TemplateId { get; }
        public DungeonModuleArchetypeV2 Archetype { get; }
        public bool ContainsWaterworks { get; }
        public bool ContainsHazardDistrict { get; }
    }

    public sealed class DungeonAuthoredCaptureRequestV2
    {
        public DungeonAuthoredCaptureRequestV2(
            string templateId,
            string viewId,
            DungeonAuthoredCaptureBandV2 band,
            DungeonAuthoredCaptureLightingV2 lighting,
            string relativePath)
        {
            TemplateId = templateId ?? throw new ArgumentNullException(nameof(templateId));
            ViewId = viewId ?? throw new ArgumentNullException(nameof(viewId));
            Band = band;
            Lighting = lighting;
            RelativePath = relativePath ?? throw new ArgumentNullException(nameof(relativePath));
        }

        public string TemplateId { get; }
        public string ViewId { get; }
        public DungeonAuthoredCaptureBandV2 Band { get; }
        public DungeonAuthoredCaptureLightingV2 Lighting { get; }
        public string RelativePath { get; }
    }

    /// <summary>Pure deterministic path and request planner used by capture tests.</summary>
    public static class DungeonAuthoredCapturePlanV2
    {
        public const int RequiredModuleCount = 24;
        public const int BaseViewsPerModule = 3;
        public const int RepresentativeViewCount = 7;
        public const int ExpectedCaptureCount =
            RequiredModuleCount * BaseViewsPerModule + RepresentativeViewCount;

        public static IReadOnlyList<DungeonAuthoredCaptureRequestV2> Build(
            IEnumerable<DungeonAuthoredCaptureSourceV2> sources)
        {
            DungeonAuthoredCaptureSourceV2[] ordered = (sources
                ?? throw new ArgumentNullException(nameof(sources)))
                .OrderBy(value => value?.TemplateId, StringComparer.Ordinal)
                .ToArray();
            if (ordered.Length != RequiredModuleCount)
                throw new InvalidOperationException("Authored capture requires exactly 24 modules; found " + ordered.Length + ".");
            if (ordered.Any(value => value == null))
                throw new InvalidOperationException("Authored capture sources may not contain null entries.");
            string duplicate = ordered.GroupBy(value => value.TemplateId, StringComparer.Ordinal)
                .Where(group => group.Count() != 1).Select(group => group.Key).FirstOrDefault();
            if (duplicate != null)
                throw new InvalidOperationException("Duplicate authored capture template ID '" + duplicate + "'.");

            var requests = new List<DungeonAuthoredCaptureRequestV2>(ExpectedCaptureCount);
            foreach (DungeonAuthoredCaptureSourceV2 source in ordered)
            {
                Add(requests, source.TemplateId, "ground", DungeonAuthoredCaptureBandV2.Ground,
                    DungeonAuthoredCaptureLightingV2.Neutral, "modules");
                Add(requests, source.TemplateId, "upper", DungeonAuthoredCaptureBandV2.Upper,
                    DungeonAuthoredCaptureLightingV2.Neutral, "modules");
                Add(requests, source.TemplateId, "lower", DungeonAuthoredCaptureBandV2.Lower,
                    DungeonAuthoredCaptureLightingV2.Neutral, "modules");
            }

            Add(requests, ordered[0].TemplateId, "bright", DungeonAuthoredCaptureBandV2.Ground,
                DungeonAuthoredCaptureLightingV2.Bright, "representative");
            Add(requests, ordered[0].TemplateId, "dark", DungeonAuthoredCaptureBandV2.Ground,
                DungeonAuthoredCaptureLightingV2.Dark, "representative");
            DungeonAuthoredCaptureSourceV2 water = ordered.FirstOrDefault(value => value.ContainsWaterworks)
                ?? throw new InvalidOperationException("No authored module represents Waterworks.");
            Add(requests, water.TemplateId, "waterworks-cyan", DungeonAuthoredCaptureBandV2.Lower,
                DungeonAuthoredCaptureLightingV2.Waterworks, "representative");
            DungeonAuthoredCaptureSourceV2 hazard = ordered.FirstOrDefault(value => value.ContainsHazardDistrict)
                ?? throw new InvalidOperationException("No authored module represents the Hazard Undercroft.");
            Add(requests, hazard.TemplateId, "hazard-magma", DungeonAuthoredCaptureBandV2.Lower,
                DungeonAuthoredCaptureLightingV2.Magma, "representative");
            Add(requests, hazard.TemplateId, "electric-safe", DungeonAuthoredCaptureBandV2.Lower,
                DungeonAuthoredCaptureLightingV2.ElectricSafe, "representative");
            Add(requests, hazard.TemplateId, "electric-charge", DungeonAuthoredCaptureBandV2.Lower,
                DungeonAuthoredCaptureLightingV2.ElectricCharge, "representative");
            Add(requests, hazard.TemplateId, "electric-live", DungeonAuthoredCaptureBandV2.Lower,
                DungeonAuthoredCaptureLightingV2.ElectricLive, "representative");

            string duplicatePath = requests.GroupBy(value => value.RelativePath, StringComparer.Ordinal)
                .Where(group => group.Count() != 1).Select(group => group.Key).FirstOrDefault();
            if (duplicatePath != null)
                throw new InvalidOperationException("Duplicate authored capture path '" + duplicatePath + "'.");
            if (requests.Count != ExpectedCaptureCount)
                throw new InvalidOperationException("Authored capture count drifted from its fixed contract.");
            return Array.AsReadOnly(requests.ToArray());
        }

        public static string ResolveOutputDirectory(string projectRoot, IReadOnlyList<string> arguments)
        {
            if (string.IsNullOrWhiteSpace(projectRoot))
                throw new ArgumentException("Unity project root is required.", nameof(projectRoot));
            string root = Path.GetFullPath(projectRoot);
            string selected = Path.Combine(root, "artifacts", "unity-captures", "dungeon-v2-authored");
            if (arguments != null)
            {
                for (int index = 0; index < arguments.Count; index += 1)
                {
                    if (!string.Equals(arguments[index], "-dungeonV2CaptureOutput", StringComparison.Ordinal)) continue;
                    if (index + 1 >= arguments.Count || string.IsNullOrWhiteSpace(arguments[index + 1]))
                        throw new ArgumentException("-dungeonV2CaptureOutput requires a path value.", nameof(arguments));
                    selected = arguments[index + 1];
                    if (!Path.IsPathRooted(selected)) selected = Path.Combine(root, selected);
                    break;
                }
            }
            return Path.GetFullPath(selected);
        }

        public static string SanitizePathSegment(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A path segment is required.", nameof(value));
            char[] invalid = Path.GetInvalidFileNameChars();
            char[] characters = value.Trim().ToLowerInvariant()
                .Select(character => invalid.Contains(character)
                    || character == '/' || character == '\\' || character == ':'
                    || char.IsWhiteSpace(character) ? '-' : character)
                .ToArray();
            string result = new string(characters);
            while (result.Contains("--")) result = result.Replace("--", "-");
            result = result.Trim('-', '.');
            if (string.IsNullOrEmpty(result))
                throw new ArgumentException("The value does not produce a safe path segment.", nameof(value));
            return result;
        }

        private static void Add(
            ICollection<DungeonAuthoredCaptureRequestV2> requests,
            string templateId,
            string viewId,
            DungeonAuthoredCaptureBandV2 band,
            DungeonAuthoredCaptureLightingV2 lighting,
            string category)
        {
            string module = SanitizePathSegment(templateId);
            string view = SanitizePathSegment(viewId);
            requests.Add(new DungeonAuthoredCaptureRequestV2(
                templateId, viewId, band, lighting,
                category + "/" + module + "/" + module + "__" + view + ".png"));
        }
    }
}
