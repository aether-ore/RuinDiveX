using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonV2PresentationPlayModeTests
    {
        [UnityTest]
        public IEnumerator BuilderCreatesCollisionFreeLandmarksSafePadsAndWaterMotionCues()
        {
            var host = new GameObject("DungeonV2PresentationHost");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("industrial-factory-v2-presentation");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                yield return null;

                DungeonDistrictLandmarkPresentationV2[] landmarks = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonDistrictLandmarkPresentationV2>(true);
                Assert.That(landmarks.Length, Is.EqualTo(plan.Anchors.Count(anchor => anchor.Kind == DungeonAnchorKindV2.Landmark)));
                Assert.That(landmarks.Select(value => value.DistrictKind).Distinct().Count(), Is.EqualTo(3));
                Assert.That(landmarks.All(value => value.EnabledCueColliderCount == 0), Is.True);

                DungeonSafePadPresentationV2[] safePads = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonSafePadPresentationV2>(true);
                Assert.That(safePads.Length, Is.EqualTo(plan.Anchors.Count(anchor => anchor.Kind == DungeonAnchorKindV2.Safe)));
                Assert.That(safePads.All(value => value.EnabledCueColliderCount == 0), Is.True);

                DungeonFluidSurfacePresentationV2[] fluids = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonFluidSurfacePresentationV2>(true);
                Assert.That(fluids.Length, Is.EqualTo(plan.FluidZones.Count));
                Assert.That(fluids.All(value => value.WaveBandCount == 4), Is.True);
                Assert.That(fluids.All(value => value.EnabledCueColliderCount == 0), Is.True);
                DungeonFluidAudioPresentationV2[] fluidAudio = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonFluidAudioPresentationV2>(true);
                Assert.That(fluidAudio.Length, Is.EqualTo(plan.FluidZones.Count));
                Assert.That(fluidAudio.All(value => value.OwnedClipCount == 1), Is.True);

                DungeonSurfacePresentationV2[] surfaces = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonSurfacePresentationV2>(true);
                Assert.That(surfaces.Any(value => value.DistrictKind == DungeonBiomeDistrictKindV2.Factory), Is.True);
                Assert.That(surfaces.Any(value => value.DistrictKind == DungeonBiomeDistrictKindV2.Waterworks), Is.True);
                Assert.That(surfaces.All(value => value.AccentCount >= 2), Is.True);
                Assert.That(surfaces.All(value => value.EnabledCueColliderCount == 0), Is.True);
            }
            finally
            {
                if (builder != null) builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator ElectricCuesExposeSafeChargeAndLiveStatesWithoutColorOnlySignaling()
        {
            var host = new GameObject("DungeonV2ElectricPresentationHost");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.ElectricalUndercroft);
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                yield return null;

                DungeonHazardDistrictRuntimeV2 district = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonHazardDistrictRuntimeV2>(true)
                    .Single(value => value.Kind == DungeonHazardSurfaceKindV2.Electric);
                district.SetAutomaticSimulation(false);
                DungeonHazardAudioPresentationV2 audio = district.GetComponent<DungeonHazardAudioPresentationV2>();
                Assert.That(audio, Is.Not.Null);
                Assert.That(audio.OwnedClipCount, Is.EqualTo(3));
                Assert.That(audio.ActiveCueId, Is.EqualTo("electric-safe"));
                DungeonHazardSurfaceCueV2[] cues = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonHazardSurfaceCueV2>(true);
                Assert.That(cues.Length, Is.GreaterThan(0));
                Assert.That(cues.All(value => value.MotionCueCount >= 3), Is.True);
                Assert.That(cues.All(value => value.EnabledCueColliderCount == 0), Is.True);
                Assert.That(cues.All(value => value.StatusText.Contains("SAFE WINDOW")), Is.True);

                district.AdvanceSimulation(1.3d);
                Assert.That(cues.All(value => value.VisualPhase == DungeonHazardVisualPhaseV2.ElectricCharging), Is.True);
                Assert.That(cues.All(value => value.StatusText.Contains("CHARGING")), Is.True);
                Assert.That(audio.ActiveCueId, Is.EqualTo("electric-charging"));

                district.AdvanceSimulation(0.8d);
                Assert.That(cues.All(value => value.VisualPhase == DungeonHazardVisualPhaseV2.ElectricEnergized), Is.True);
                Assert.That(cues.All(value => value.StatusText.Contains("LIVE")), Is.True);
                Assert.That(audio.ActiveCueId, Is.EqualTo("electric-live"));
            }
            finally
            {
                if (builder != null) builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator MagmaCuesExposeHeatColumnsAndWrittenWarning()
        {
            var host = new GameObject("DungeonV2MagmaPresentationHost");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                yield return null;

                DungeonHazardSurfaceCueV2[] cues = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonHazardSurfaceCueV2>(true);
                Assert.That(cues.Length, Is.GreaterThan(0));
                Assert.That(cues.All(value => value.Kind == DungeonHazardSurfaceKindV2.Magma), Is.True);
                Assert.That(cues.All(value => value.MotionCueCount >= 5), Is.True);
                Assert.That(cues.All(value => value.StatusText.Contains("MAGMA")), Is.True);
                Assert.That(cues.All(value => value.EnabledCueColliderCount == 0), Is.True);
                DungeonHazardAudioPresentationV2 audio = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonHazardAudioPresentationV2>(true)
                    .Single();
                Assert.That(audio.OwnedClipCount, Is.EqualTo(1));
                Assert.That(audio.ActiveCueId, Is.EqualTo("magma-active"));
            }
            finally
            {
                if (builder != null) builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        private static DungeonPlanV2 FindPlan(DungeonBiomeDistrictKindV2 kind)
        {
            var generator = new IndustrialFactoryV2Generator();
            for (int index = 0; index < 128; index += 1)
            {
                DungeonPlanV2 plan = generator.Generate("industrial-factory-v2-presentation-" + kind + "-" + index);
                if (plan.Districts.Any(district => district.Kind == kind))
                {
                    return plan;
                }
            }

            throw new InvalidOperationException("No deterministic presentation fixture produced district " + kind + ".");
        }
    }
}
