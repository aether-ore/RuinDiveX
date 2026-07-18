using System;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Low-volume, deterministic synthesized warning/ambience. Clips are
    /// runtime-owned, never persisted, and explicitly destroyed with the
    /// generated dungeon.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonHazardAudioPresentationV2 : MonoBehaviour
    {
        private DungeonHazardDistrictRuntimeV2 district;
        private AudioSource source;
        private AudioClip quietClip;
        private AudioClip chargingClip;
        private AudioClip liveClip;

        public string ActiveCueId { get; private set; }
        public int OwnedClipCount => Count(quietClip) + Count(chargingClip) + Count(liveClip);

        public void Configure(DungeonHazardDistrictRuntimeV2 targetDistrict)
        {
            Unbind();
            district = targetDistrict != null
                ? targetDistrict
                : throw new ArgumentNullException(nameof(targetDistrict));
            source = GetComponent<AudioSource>() ?? gameObject.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.loop = true;
            source.spatialBlend = 1f;
            source.dopplerLevel = 0f;
            source.minDistance = 2f;
            source.maxDistance = 18f;
            source.rolloffMode = AudioRolloffMode.Linear;
            source.volume = district.Kind == DungeonHazardSurfaceKindV2.Magma ? 0.055f : 0.045f;

            uint seed = DungeonProceduralAudioKernelV2.Hash(district.ControllerId);
            if (district.Kind == DungeonHazardSurfaceKindV2.Magma)
            {
                quietClip = DungeonProceduralAudioKernelV2.Create(
                    "V2_MagmaAmbience_" + district.ControllerId,
                    seed,
                    (sample, count, noise) =>
                    {
                        float phase = sample / (float)count;
                        return Mathf.Sin(phase * Mathf.PI * 2f * 48f) * 0.18f
                            + Mathf.Sin(phase * Mathf.PI * 2f * 73f) * 0.08f
                            + noise * 0.045f;
                    });
            }
            else
            {
                quietClip = DungeonProceduralAudioKernelV2.Create(
                    "V2_ElectricSafe_" + district.ControllerId,
                    seed,
                    (sample, count, noise) => Mathf.Sin(sample / (float)count * Mathf.PI * 2f * 60f) * 0.08f);
                chargingClip = DungeonProceduralAudioKernelV2.Create(
                    "V2_ElectricCharging_" + district.ControllerId,
                    seed ^ 0x5f3759dfu,
                    (sample, count, noise) =>
                    {
                        float phase = sample / (float)count;
                        float warningGate = Mathf.Sin(phase * Mathf.PI * 2f * 4f) > 0f ? 1f : 0.12f;
                        return Mathf.Sin(phase * Mathf.PI * 2f * 240f) * warningGate * 0.20f;
                    });
                liveClip = DungeonProceduralAudioKernelV2.Create(
                    "V2_ElectricLive_" + district.ControllerId,
                    seed ^ 0xa511e9b3u,
                    (sample, count, noise) =>
                    {
                        float phase = sample / (float)count;
                        return Mathf.Sin(phase * Mathf.PI * 2f * 120f) * 0.11f
                            + noise * (Mathf.Sin(phase * Mathf.PI * 2f * 12f) > 0.72f ? 0.24f : 0.035f);
                    });
            }

            district.VisualPhaseChanged += HandlePhaseChanged;
            HandlePhaseChanged(district.VisualPhase);
        }

        private void OnDestroy()
        {
            Unbind();
            if (source != null)
            {
                source.Stop();
                source.clip = null;
            }
            DestroyClip(quietClip);
            DestroyClip(chargingClip);
            DestroyClip(liveClip);
            quietClip = null;
            chargingClip = null;
            liveClip = null;
        }

        private void HandlePhaseChanged(DungeonHazardVisualPhaseV2 phase)
        {
            AudioClip next;
            switch (phase)
            {
                case DungeonHazardVisualPhaseV2.ElectricCharging:
                    next = chargingClip;
                    ActiveCueId = "electric-charging";
                    break;
                case DungeonHazardVisualPhaseV2.ElectricEnergized:
                    next = liveClip;
                    ActiveCueId = "electric-live";
                    break;
                case DungeonHazardVisualPhaseV2.ElectricGrounded:
                    next = quietClip;
                    ActiveCueId = "electric-grounded";
                    break;
                case DungeonHazardVisualPhaseV2.ElectricSafe:
                    next = quietClip;
                    ActiveCueId = "electric-safe";
                    break;
                default:
                    next = quietClip;
                    ActiveCueId = "magma-active";
                    break;
            }

            if (source == null || source.clip == next)
            {
                return;
            }

            source.Stop();
            source.clip = next;
            if (Application.isPlaying && isActiveAndEnabled && next != null)
            {
                source.Play();
            }
        }

        private void Unbind()
        {
            if (district != null)
            {
                district.VisualPhaseChanged -= HandlePhaseChanged;
            }
        }

        private static int Count(AudioClip clip) => clip != null ? 1 : 0;

        private static void DestroyClip(AudioClip clip)
        {
            if (clip == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(clip);
            else UnityEngine.Object.DestroyImmediate(clip);
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonFluidAudioPresentationV2 : MonoBehaviour
    {
        private AudioClip ownedClip;
        private AudioSource source;

        public string StableFluidZoneId { get; private set; }
        public int OwnedClipCount => ownedClip != null ? 1 : 0;

        public void Configure(string stableFluidZoneId)
        {
            StableFluidZoneId = string.IsNullOrWhiteSpace(stableFluidZoneId)
                ? throw new ArgumentException("A stable fluid-zone id is required.", nameof(stableFluidZoneId))
                : stableFluidZoneId.Trim();
            source = GetComponent<AudioSource>() ?? gameObject.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.loop = true;
            source.spatialBlend = 1f;
            source.dopplerLevel = 0f;
            source.minDistance = 2f;
            source.maxDistance = 16f;
            source.rolloffMode = AudioRolloffMode.Linear;
            source.volume = 0.035f;
            uint seed = DungeonProceduralAudioKernelV2.Hash(StableFluidZoneId);
            ownedClip = DungeonProceduralAudioKernelV2.Create(
                "V2_WaterAmbience_" + StableFluidZoneId,
                seed,
                (sample, count, noise) =>
                {
                    float phase = sample / (float)count;
                    float bubble = Mathf.Sin(phase * Mathf.PI * 2f * 7f) > 0.92f ? noise * 0.12f : 0f;
                    return Mathf.Sin(phase * Mathf.PI * 2f * 36f) * 0.06f + noise * 0.025f + bubble;
                });
            source.clip = ownedClip;
            if (Application.isPlaying && isActiveAndEnabled)
            {
                source.Play();
            }
        }

        private void OnEnable()
        {
            if (Application.isPlaying && source != null && source.clip != null && !source.isPlaying)
            {
                source.Play();
            }
        }

        private void OnDisable()
        {
            if (source != null)
            {
                source.Stop();
            }
        }

        private void OnDestroy()
        {
            if (source != null)
            {
                source.Stop();
                source.clip = null;
            }
            if (ownedClip == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(ownedClip);
            else UnityEngine.Object.DestroyImmediate(ownedClip);
            ownedClip = null;
        }
    }

    internal static class DungeonProceduralAudioKernelV2
    {
        private const int SampleRate = 12000;
        private const int SampleCount = 12000;

        internal delegate float SampleFunction(int sample, int count, float deterministicNoise);

        internal static AudioClip Create(string name, uint seed, SampleFunction sampler)
        {
            // Streaming callbacks avoid editor/test-runner SetData limitations
            // while remaining deterministic: every one-second loop is a pure
            // function of stable ID seed and sample index.
            AudioClip clip = AudioClip.Create(
                name,
                SampleCount,
                1,
                SampleRate,
                true,
                data =>
                {
                    for (int index = 0; index < data.Length; index += 1)
                    {
                        data[index] = Mathf.Clamp(
                            sampler(index, data.Length, Noise(seed, index)),
                            -0.85f,
                            0.85f);
                    }
                });
            clip.hideFlags = HideFlags.DontSave;
            return clip;
        }

        internal static uint Hash(string value)
        {
            uint hash = 2166136261u;
            for (int index = 0; index < value.Length; index += 1)
            {
                hash ^= value[index];
                hash *= 16777619u;
            }

            return hash;
        }

        private static float Noise(uint seed, int sample)
        {
            uint value = seed + (uint)sample * 747796405u + 2891336453u;
            value = ((value >> ((int)(value >> 28) + 4)) ^ value) * 277803737u;
            value = (value >> 22) ^ value;
            return (value & 0xffffu) / 32767.5f - 1f;
        }
    }
}
