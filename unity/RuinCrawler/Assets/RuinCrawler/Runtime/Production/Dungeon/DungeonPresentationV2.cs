using System;
using System.Collections.Generic;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Presentation-only detail for a certified surface. These strips never own
    /// collision and therefore cannot change the plan's traversal geometry.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonSurfacePresentationV2 : MonoBehaviour
    {
        private readonly List<Renderer> accentRenderers = new List<Renderer>();
        private MaterialPropertyBlock propertyBlock;
        private float visualClock;

        public DungeonBiomeDistrictKindV2 DistrictKind { get; private set; }
        public DungeonSurfaceKindV2 SurfaceKind { get; private set; }
        public int AccentCount => accentRenderers.Count;
        public int EnabledCueColliderCount => CountEnabledCueColliders(transform);

        public void Configure(
            Renderer surfaceRenderer,
            DungeonBiomeDistrictKindV2 districtKind,
            DungeonSurfaceKindV2 surfaceKind,
            Material accentMaterial)
        {
            DistrictKind = districtKind;
            SurfaceKind = surfaceKind;
            propertyBlock = propertyBlock ?? new MaterialPropertyBlock();
            accentRenderers.Clear();

            if (surfaceRenderer == null || accentMaterial == null)
            {
                return;
            }

            Bounds bounds = surfaceRenderer.bounds;
            float top = bounds.max.y + 0.018f;
            if (districtKind == DungeonBiomeDistrictKindV2.Factory)
            {
                AddStrip("FactoryEdgeA", new Vector3(bounds.center.x, top, bounds.min.z + 0.22f),
                    new Vector3(Mathf.Max(0.4f, bounds.size.x - 0.5f), 0.035f, 0.08f), accentMaterial);
                AddStrip("FactoryEdgeB", new Vector3(bounds.center.x, top, bounds.max.z - 0.22f),
                    new Vector3(Mathf.Max(0.4f, bounds.size.x - 0.5f), 0.035f, 0.08f), accentMaterial);
            }
            else if (districtKind == DungeonBiomeDistrictKindV2.Waterworks)
            {
                float offset = Mathf.Min(0.8f, bounds.size.x * 0.2f);
                AddStrip("WaterConduitA", new Vector3(bounds.center.x - offset, top, bounds.center.z),
                    new Vector3(0.10f, 0.045f, Mathf.Max(0.4f, bounds.size.z - 0.5f)), accentMaterial);
                AddStrip("WaterConduitB", new Vector3(bounds.center.x + offset, top, bounds.center.z),
                    new Vector3(0.10f, 0.045f, Mathf.Max(0.4f, bounds.size.z - 0.5f)), accentMaterial);
            }
            else
            {
                AddStrip("UndercroftWarningA", new Vector3(bounds.center.x, top, bounds.center.z - 0.55f),
                    new Vector3(Mathf.Min(2.2f, bounds.size.x * 0.5f), 0.045f, 0.11f), accentMaterial);
                AddStrip("UndercroftWarningB", new Vector3(bounds.center.x, top, bounds.center.z + 0.55f),
                    new Vector3(Mathf.Min(2.2f, bounds.size.x * 0.5f), 0.045f, 0.11f), accentMaterial);
            }
        }

        private void Update()
        {
            visualClock += Time.deltaTime;
            if (DistrictKind != DungeonBiomeDistrictKindV2.Waterworks || accentRenderers.Count == 0)
            {
                return;
            }

            float pulse = 0.58f + Mathf.Sin(visualClock * 2.2f) * 0.18f;
            Color color = new Color(0.12f, 0.88f, 0.92f, 1f) * pulse;
            for (int index = 0; index < accentRenderers.Count; index += 1)
            {
                ApplyEmission(accentRenderers[index], color);
            }
        }

        private void AddStrip(string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject strip = PresentationPrimitiveV2.Create(PrimitiveType.Cube, name, transform, material);
            strip.transform.position = position;
            strip.transform.localScale = scale;
            accentRenderers.Add(strip.GetComponent<Renderer>());
        }

        private void ApplyEmission(Renderer renderer, Color color)
        {
            renderer.GetPropertyBlock(propertyBlock);
            propertyBlock.SetColor(PresentationPrimitiveV2.EmissionColorId, color);
            renderer.SetPropertyBlock(propertyBlock);
        }

        internal static int CountEnabledCueColliders(Transform root)
        {
            int count = 0;
            Collider[] colliders = root.GetComponentsInChildren<Collider>(true);
            for (int index = 0; index < colliders.Length; index += 1)
            {
                if (colliders[index] != null
                    && colliders[index].transform != root
                    && colliders[index].enabled
                    && colliders[index].GetComponent<Renderer>() != null)
                {
                    count += 1;
                }
            }

            return count;
        }
    }

    /// <summary>
    /// Adds explicit non-color hazard language: a written state, corner
    /// beacons, and phase-specific moving conductor/heat bars.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonHazardSurfaceCueV2 : MonoBehaviour
    {
        private readonly List<Transform> motionCues = new List<Transform>();
        private readonly List<Renderer> cueRenderers = new List<Renderer>();
        private DungeonHazardDistrictRuntimeV2 district;
        private DungeonHazardSurfaceKindV2 kind;
        private TextMesh statusLabel;
        private MaterialPropertyBlock propertyBlock;
        private float visualClock;
        private Bounds surfaceBounds;

        public DungeonHazardSurfaceKindV2 Kind => kind;
        public DungeonHazardVisualPhaseV2 VisualPhase { get; private set; }
        public string StatusText => statusLabel != null ? statusLabel.text : string.Empty;
        public int MotionCueCount => motionCues.Count;
        public int EnabledCueColliderCount => DungeonSurfacePresentationV2.CountEnabledCueColliders(transform);

        public void Configure(
            Renderer surfaceRenderer,
            DungeonHazardDistrictRuntimeV2 targetDistrict,
            Material warningMaterial,
            Material darkMaterial)
        {
            Unbind();
            if (surfaceRenderer == null) throw new ArgumentNullException(nameof(surfaceRenderer));
            district = targetDistrict != null ? targetDistrict : throw new ArgumentNullException(nameof(targetDistrict));
            kind = district.Kind;
            propertyBlock = propertyBlock ?? new MaterialPropertyBlock();
            surfaceBounds = surfaceRenderer.bounds;
            BuildCues(warningMaterial, darkMaterial);
            district.VisualPhaseChanged += ApplyPhase;
            ApplyPhase(district.VisualPhase);
        }

        private void OnDestroy()
        {
            Unbind();
        }

        private void Update()
        {
            visualClock += Time.deltaTime;
            float wave = (Mathf.Sin(visualClock * (VisualPhase == DungeonHazardVisualPhaseV2.ElectricEnergized ? 10f : 4f)) + 1f) * 0.5f;
            for (int index = 0; index < motionCues.Count; index += 1)
            {
                Transform cue = motionCues[index];
                if (cue == null) continue;
                float phaseOffset = index * 0.43f;
                if (kind == DungeonHazardSurfaceKindV2.Magma)
                {
                    float rise = (visualClock * 0.55f + phaseOffset) % 0.7f;
                    cue.position = new Vector3(cue.position.x, surfaceBounds.max.y + 0.12f + rise, cue.position.z);
                    cue.localScale = new Vector3(cue.localScale.x, 0.12f + (1f - rise) * 0.65f, cue.localScale.z);
                }
                else if (VisualPhase == DungeonHazardVisualPhaseV2.ElectricCharging)
                {
                    cue.localRotation = Quaternion.Euler(0f, 0f, (visualClock * 80f + index * 22f) % 360f);
                    cue.localScale = new Vector3(cue.localScale.x, 0.04f + wave * 0.35f, cue.localScale.z);
                }
                else if (VisualPhase == DungeonHazardVisualPhaseV2.ElectricEnergized)
                {
                    cue.localRotation = Quaternion.Euler(0f, (visualClock * 220f + index * 37f) % 360f, 25f);
                    cue.localScale = new Vector3(cue.localScale.x, 0.25f + wave * 0.45f, cue.localScale.z);
                }
                else
                {
                    cue.localRotation = Quaternion.identity;
                    cue.localScale = new Vector3(cue.localScale.x, 0.04f, cue.localScale.z);
                }
            }

            FaceCamera(statusLabel != null ? statusLabel.transform : null);
        }

        private void BuildCues(Material warningMaterial, Material darkMaterial)
        {
            motionCues.Clear();
            cueRenderers.Clear();
            float top = surfaceBounds.max.y + 0.08f;
            float insetX = Mathf.Min(0.3f, surfaceBounds.extents.x * 0.25f);
            float insetZ = Mathf.Min(0.3f, surfaceBounds.extents.z * 0.25f);
            Vector3[] corners =
            {
                new Vector3(surfaceBounds.min.x + insetX, top + 0.25f, surfaceBounds.min.z + insetZ),
                new Vector3(surfaceBounds.max.x - insetX, top + 0.25f, surfaceBounds.min.z + insetZ),
                new Vector3(surfaceBounds.min.x + insetX, top + 0.25f, surfaceBounds.max.z - insetZ),
                new Vector3(surfaceBounds.max.x - insetX, top + 0.25f, surfaceBounds.max.z - insetZ)
            };
            for (int index = 0; index < corners.Length; index += 1)
            {
                GameObject post = PresentationPrimitiveV2.Create(
                    PrimitiveType.Cylinder,
                    "WarningPost_" + index,
                    transform,
                    index % 2 == 0 ? warningMaterial : darkMaterial);
                post.transform.position = corners[index];
                post.transform.localScale = new Vector3(0.14f, 0.28f, 0.14f);
                cueRenderers.Add(post.GetComponent<Renderer>());
            }

            int barCount = kind == DungeonHazardSurfaceKindV2.Magma ? 5 : 3;
            for (int index = 0; index < barCount; index += 1)
            {
                GameObject bar = PresentationPrimitiveV2.Create(
                    PrimitiveType.Cube,
                    kind == DungeonHazardSurfaceKindV2.Magma ? "HeatColumn_" + index : "ConductorBar_" + index,
                    transform,
                    warningMaterial);
                float fraction = (index + 1f) / (barCount + 1f);
                bar.transform.position = new Vector3(
                    Mathf.Lerp(surfaceBounds.min.x + insetX, surfaceBounds.max.x - insetX, fraction),
                    top + 0.05f,
                    surfaceBounds.center.z);
                bar.transform.localScale = kind == DungeonHazardSurfaceKindV2.Magma
                    ? new Vector3(0.10f, 0.35f, Mathf.Max(0.28f, surfaceBounds.size.z * 0.16f))
                    : new Vector3(Mathf.Max(0.35f, surfaceBounds.size.x * 0.18f), 0.04f, 0.08f);
                motionCues.Add(bar.transform);
                cueRenderers.Add(bar.GetComponent<Renderer>());
            }

            GameObject labelObject = new GameObject("HazardStatusPlacard");
            labelObject.transform.SetParent(transform, false);
            labelObject.transform.position = new Vector3(surfaceBounds.center.x, surfaceBounds.max.y + 1.15f, surfaceBounds.center.z);
            statusLabel = labelObject.AddComponent<TextMesh>();
            statusLabel.anchor = TextAnchor.MiddleCenter;
            statusLabel.alignment = TextAlignment.Center;
            statusLabel.fontSize = 64;
            statusLabel.characterSize = 0.045f;
            statusLabel.color = Color.white;
        }

        private void ApplyPhase(DungeonHazardVisualPhaseV2 phase)
        {
            VisualPhase = phase;
            string text;
            Color color;
            switch (phase)
            {
                case DungeonHazardVisualPhaseV2.MagmaActive:
                    text = "!! MAGMA // HOT !!";
                    color = new Color(1f, 0.28f, 0.025f, 1f);
                    break;
                case DungeonHazardVisualPhaseV2.ElectricCharging:
                    text = "^^ CHARGING // CLEAR FLOOR ^^";
                    color = new Color(1f, 0.72f, 0.08f, 1f);
                    break;
                case DungeonHazardVisualPhaseV2.ElectricEnergized:
                    text = "XX LIVE // WAIT XX";
                    color = new Color(0.35f, 0.95f, 1f, 1f);
                    break;
                case DungeonHazardVisualPhaseV2.ElectricGrounded:
                    text = "-- GROUNDED // SAFE --";
                    color = new Color(0.32f, 0.85f, 0.60f, 1f);
                    break;
                default:
                    text = ">> SAFE WINDOW // CROSS >>";
                    color = new Color(0.72f, 0.95f, 1f, 1f);
                    break;
            }

            if (statusLabel != null)
            {
                statusLabel.text = text;
                statusLabel.color = color;
            }

            Color emission = color * (phase == DungeonHazardVisualPhaseV2.ElectricEnergized ? 3.4f : 1.7f);
            for (int index = 0; index < cueRenderers.Count; index += 1)
            {
                Renderer renderer = cueRenderers[index];
                if (renderer == null) continue;
                renderer.GetPropertyBlock(propertyBlock);
                propertyBlock.SetColor(PresentationPrimitiveV2.BaseColorId, color);
                propertyBlock.SetColor(PresentationPrimitiveV2.ColorId, color);
                propertyBlock.SetColor(PresentationPrimitiveV2.EmissionColorId, emission);
                renderer.SetPropertyBlock(propertyBlock);
            }
        }

        private void Unbind()
        {
            if (district != null)
            {
                district.VisualPhaseChanged -= ApplyPhase;
            }
        }

        private static void FaceCamera(Transform target)
        {
            Camera camera = Camera.main;
            if (target == null || camera == null) return;
            Vector3 direction = target.position - camera.transform.position;
            if (direction.sqrMagnitude > 0.001f)
            {
                target.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
            }
        }
    }

    /// <summary>
    /// Moving water-level bands make flooded volumes legible from upper floors
    /// and against both bright and dark backdrops.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonFluidSurfacePresentationV2 : MonoBehaviour
    {
        private readonly List<Transform> waveBands = new List<Transform>();
        private readonly List<Renderer> waveRenderers = new List<Renderer>();
        private readonly List<Vector3> basePositions = new List<Vector3>();
        private MaterialPropertyBlock propertyBlock;
        private float visualClock;
        private float baseHeight;

        public string StableFluidZoneId { get; private set; }
        public int WaveBandCount => waveBands.Count;
        public int EnabledCueColliderCount => DungeonSurfacePresentationV2.CountEnabledCueColliders(transform);

        public void Configure(string fluidZoneId, Renderer volumeRenderer, Material waveMaterial)
        {
            StableFluidZoneId = string.IsNullOrWhiteSpace(fluidZoneId)
                ? throw new ArgumentException("A stable fluid-zone id is required.", nameof(fluidZoneId))
                : fluidZoneId.Trim();
            if (volumeRenderer == null) throw new ArgumentNullException(nameof(volumeRenderer));
            propertyBlock = propertyBlock ?? new MaterialPropertyBlock();
            Bounds bounds = volumeRenderer.bounds;
            baseHeight = bounds.max.y + 0.025f;
            waveBands.Clear();
            waveRenderers.Clear();
            basePositions.Clear();
            for (int index = 0; index < 4; index += 1)
            {
                GameObject wave = PresentationPrimitiveV2.Create(
                    PrimitiveType.Cube,
                    "WaterLevelBand_" + index,
                    transform,
                    waveMaterial);
                float z = Mathf.Lerp(bounds.min.z + 0.35f, bounds.max.z - 0.35f, (index + 0.5f) / 4f);
                wave.transform.position = new Vector3(bounds.center.x, baseHeight, z);
                wave.transform.localScale = new Vector3(Mathf.Max(0.5f, bounds.size.x - 0.5f), 0.025f, 0.045f);
                waveBands.Add(wave.transform);
                waveRenderers.Add(wave.GetComponent<Renderer>());
                basePositions.Add(wave.transform.position);
            }
        }

        private void Update()
        {
            visualClock += Time.deltaTime;
            for (int index = 0; index < waveBands.Count; index += 1)
            {
                Transform wave = waveBands[index];
                if (wave == null) continue;
                float offset = Mathf.Sin(visualClock * 1.8f + index * 0.9f);
                Vector3 position = basePositions[index];
                position.y = baseHeight + offset * 0.045f;
                position.x += Mathf.Sin(visualClock * 0.55f + index) * 0.12f;
                wave.position = position;
                wave.localRotation = Quaternion.Euler(0f, offset * 7f, 0f);

                Renderer renderer = waveRenderers[index];
                renderer.GetPropertyBlock(propertyBlock);
                Color glow = new Color(0.18f, 0.90f, 1f, 1f) * (0.75f + offset * 0.18f);
                propertyBlock.SetColor(PresentationPrimitiveV2.EmissionColorId, glow);
                renderer.SetPropertyBlock(propertyBlock);
            }
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonSafePadPresentationV2 : MonoBehaviour
    {
        public string StableAnchorId { get; private set; }
        public int EnabledCueColliderCount => DungeonSurfacePresentationV2.CountEnabledCueColliders(transform);

        public void Configure(string stableAnchorId, Material padMaterial, Material symbolMaterial)
        {
            StableAnchorId = string.IsNullOrWhiteSpace(stableAnchorId)
                ? throw new ArgumentException("A stable safe-anchor id is required.", nameof(stableAnchorId))
                : stableAnchorId.Trim();
            GameObject pad = PresentationPrimitiveV2.Create(PrimitiveType.Cylinder, "SafePad", transform, padMaterial);
            pad.transform.localPosition = Vector3.up * 0.035f;
            pad.transform.localScale = new Vector3(0.86f, 0.035f, 0.86f);
            AddSymbol("SafeCrossHorizontal", new Vector3(0f, 0.095f, 0f), new Vector3(0.78f, 0.025f, 0.18f), symbolMaterial);
            AddSymbol("SafeCrossVertical", new Vector3(0f, 0.095f, 0f), new Vector3(0.18f, 0.025f, 0.78f), symbolMaterial);

            GameObject label = new GameObject("SafePadLabel");
            label.transform.SetParent(transform, false);
            label.transform.localPosition = new Vector3(0f, 0.7f, 0f);
            TextMesh text = label.AddComponent<TextMesh>();
            text.text = "SAFE RETURN";
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.fontSize = 48;
            text.characterSize = 0.035f;
            text.color = new Color(0.72f, 1f, 0.82f, 1f);
        }

        private void AddSymbol(string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject part = PresentationPrimitiveV2.Create(PrimitiveType.Cube, name, transform, material);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
        }
    }

    [DisallowMultipleComponent]
    public sealed class DungeonDistrictLandmarkPresentationV2 : MonoBehaviour
    {
        private Transform animatedPart;
        private TextMesh label;
        private float visualClock;

        public string StableAnchorId { get; private set; }
        public DungeonBiomeDistrictKindV2 DistrictKind { get; private set; }
        public int EnabledCueColliderCount => DungeonSurfacePresentationV2.CountEnabledCueColliders(transform);

        public void Configure(
            string stableAnchorId,
            DungeonBiomeDistrictKindV2 districtKind,
            Material primaryMaterial,
            Material accentMaterial,
            Material darkMaterial)
        {
            StableAnchorId = string.IsNullOrWhiteSpace(stableAnchorId)
                ? throw new ArgumentException("A stable landmark-anchor id is required.", nameof(stableAnchorId))
                : stableAnchorId.Trim();
            DistrictKind = districtKind;
            switch (districtKind)
            {
                case DungeonBiomeDistrictKindV2.Waterworks:
                    BuildWaterworks(primaryMaterial, accentMaterial, darkMaterial);
                    break;
                case DungeonBiomeDistrictKindV2.MagmaUndercroft:
                    BuildMagma(primaryMaterial, accentMaterial, darkMaterial);
                    break;
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft:
                    BuildElectric(primaryMaterial, accentMaterial, darkMaterial);
                    break;
                default:
                    BuildFactory(primaryMaterial, accentMaterial, darkMaterial);
                    break;
            }

            GameObject labelObject = new GameObject("DistrictLandmarkLabel");
            labelObject.transform.SetParent(transform, false);
            labelObject.transform.localPosition = new Vector3(0f, 3.5f, 0f);
            label = labelObject.AddComponent<TextMesh>();
            label.text = DistrictLabel(districtKind);
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 64;
            label.characterSize = 0.052f;
            label.color = Color.white;
        }

        private void Update()
        {
            visualClock += Time.deltaTime;
            if (animatedPart != null)
            {
                animatedPart.localRotation = Quaternion.Euler(
                    DistrictKind == DungeonBiomeDistrictKindV2.Waterworks ? 90f : 0f,
                    visualClock * (DistrictKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft ? 120f : 38f),
                    0f);
            }

            Camera camera = Camera.main;
            if (label != null && camera != null)
            {
                Vector3 direction = label.transform.position - camera.transform.position;
                if (direction.sqrMagnitude > 0.001f)
                {
                    label.transform.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
                }
            }
        }

        private void BuildFactory(Material primary, Material accent, Material dark)
        {
            Add(PrimitiveType.Cube, "FactoryPylon", new Vector3(0f, 1.25f, 0f), new Vector3(0.65f, 2.5f, 0.65f), primary);
            Add(PrimitiveType.Cube, "FactoryCrossbeam", new Vector3(0f, 2.25f, 0f), new Vector3(2.1f, 0.22f, 0.30f), dark);
            animatedPart = Add(PrimitiveType.Cylinder, "FactorySignalRotor", new Vector3(0f, 2.7f, 0f), new Vector3(0.56f, 0.12f, 0.56f), accent).transform;
        }

        private void BuildWaterworks(Material primary, Material accent, Material dark)
        {
            for (int index = -1; index <= 1; index += 1)
            {
                Add(PrimitiveType.Cylinder, "WaterPipe_" + index, new Vector3(index * 0.62f, 1.1f, 0f), new Vector3(0.34f, 1.1f, 0.34f), primary);
            }

            Add(PrimitiveType.Cube, "WaterValveBracket", new Vector3(0f, 1.45f, -0.35f), new Vector3(1.8f, 0.18f, 0.18f), dark);
            animatedPart = Add(PrimitiveType.Cylinder, "WaterMasterValve", new Vector3(0f, 1.75f, -0.58f), new Vector3(0.72f, 0.10f, 0.72f), accent).transform;
            animatedPart.localRotation = Quaternion.Euler(90f, 0f, 0f);
        }

        private void BuildMagma(Material primary, Material accent, Material dark)
        {
            Add(PrimitiveType.Cube, "FurnaceBase", new Vector3(0f, 0.55f, 0f), new Vector3(1.7f, 1.1f, 1.4f), dark);
            Add(PrimitiveType.Cylinder, "FurnaceStackA", new Vector3(-0.45f, 1.75f, 0f), new Vector3(0.34f, 1.2f, 0.34f), primary);
            Add(PrimitiveType.Cylinder, "FurnaceStackB", new Vector3(0.45f, 1.45f, 0f), new Vector3(0.28f, 0.9f, 0.28f), primary);
            animatedPart = Add(PrimitiveType.Cube, "FurnaceHeatBeacon", new Vector3(0f, 2.65f, 0f), new Vector3(0.82f, 0.12f, 0.82f), accent).transform;
        }

        private void BuildElectric(Material primary, Material accent, Material dark)
        {
            Add(PrimitiveType.Cube, "TransformerBase", new Vector3(0f, 0.45f, 0f), new Vector3(1.7f, 0.9f, 1.2f), dark);
            Add(PrimitiveType.Cylinder, "TransformerCoilA", new Vector3(-0.5f, 1.4f, 0f), new Vector3(0.42f, 0.8f, 0.42f), primary);
            Add(PrimitiveType.Cylinder, "TransformerCoilB", new Vector3(0.5f, 1.4f, 0f), new Vector3(0.42f, 0.8f, 0.42f), primary);
            animatedPart = Add(PrimitiveType.Cube, "ElectricPhaseRotor", new Vector3(0f, 2.3f, 0f), new Vector3(1.5f, 0.10f, 0.12f), accent).transform;
        }

        private GameObject Add(PrimitiveType type, string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject part = PresentationPrimitiveV2.Create(type, name, transform, material);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            return part;
        }

        private static string DistrictLabel(DungeonBiomeDistrictKindV2 kind)
        {
            switch (kind)
            {
                case DungeonBiomeDistrictKindV2.Waterworks: return "WATERWORKS // FLOW CONTROL";
                case DungeonBiomeDistrictKindV2.MagmaUndercroft: return "UNDERCROFT // MAGMA PROCESSING";
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft: return "UNDERCROFT // ELECTRICAL DISTRIBUTION";
                default: return "FACTORY // PRODUCTION LINE";
            }
        }
    }

    internal static class PresentationPrimitiveV2
    {
        internal static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        internal static readonly int ColorId = Shader.PropertyToID("_Color");
        internal static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");

        internal static GameObject Create(
            PrimitiveType primitiveType,
            string name,
            Transform parent,
            Material material)
        {
            GameObject result = GameObject.CreatePrimitive(primitiveType);
            result.name = name;
            result.transform.SetParent(parent, false);
            Collider collider = result.GetComponent<Collider>();
            if (collider != null)
            {
                collider.enabled = false;
                if (Application.isPlaying) UnityEngine.Object.Destroy(collider);
                else UnityEngine.Object.DestroyImmediate(collider);
            }

            Renderer renderer = result.GetComponent<Renderer>();
            if (renderer != null)
            {
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }

            return result;
        }
    }
}
