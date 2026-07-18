using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RuinCrawler.Editor.DungeonV2
{
    [Serializable]
    internal sealed class DungeonAuthoredCaptureManifestV2
    {
        public int schemaVersion = 1;
        public string contentPackId;
        public string registryAssetPath;
        public int width;
        public int height;
        public int captureCount;
        public DungeonAuthoredCaptureManifestEntryV2[] captures;
    }

    [Serializable]
    internal sealed class DungeonAuthoredCaptureManifestEntryV2
    {
        public string templateId;
        public string moduleRevisionHash;
        public string archetype;
        public string viewId;
        public string band;
        public string lighting;
        public string regionId;
        public string relativePath;
        public string cameraLocalPosition;
        public string cameraLocalTarget;
        public float clearPixelFraction;
        public string sha256;
    }

    /// <summary>
    /// Batch-safe visual acceptance capture for the baked authored V2 library. Each exact
    /// registry prefab is instantiated in a temporary preview scene; no scene, prefab,
    /// material, texture, registry, or descriptor asset is modified by this utility.
    /// </summary>
    public static class DungeonAuthoredModuleCaptureV2
    {
        private const int CaptureWidth = 960;
        private const int CaptureHeight = 540;
        private const int ProbeWidth = 320;
        private const int ProbeHeight = 180;
        private const float MaximumClearPixelFraction = 0f;
        private const string RegistryAssetPath =
            "Assets/RuinCrawler/Resources/DungeonV2/DungeonAuthoredModuleRegistryV2.asset";
        private static readonly Color SentinelColor = new Color(1f, 0f, 1f, 1f);

        [MenuItem("Ruin Crawler/Dungeon V2/Capture Authored Module Library")]
        public static void CaptureAllMenu()
        {
            try
            {
                string manifest = CaptureAll();
                Debug.Log("Authored Dungeon V2 visual-QA capture passed: " + manifest);
                EditorUtility.RevealInFinder(manifest);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                EditorUtility.DisplayDialog("Authored Dungeon V2 capture failed", exception.Message, "Close");
            }
        }

        /// <summary>Entry point for Unity -batchmode -executeMethod.</summary>
        public static void CaptureAllBatch()
        {
            string manifest = CaptureAll();
            Debug.Log("AUTHORED_DUNGEON_V2_CAPTURE_MANIFEST=" + manifest);
        }

        public static string CaptureAll()
        {
            string projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            string outputDirectory = DungeonAuthoredCapturePlanV2.ResolveOutputDirectory(
                projectRoot, Environment.GetCommandLineArgs());
            Directory.CreateDirectory(outputDirectory);
            string failurePath = Path.Combine(outputDirectory, "capture-failure.txt");
            if (File.Exists(failurePath)) File.Delete(failurePath);

            try
            {
                DungeonAuthoredModuleRegistryV2 registry =
                    AssetDatabase.LoadAssetAtPath<DungeonAuthoredModuleRegistryV2>(RegistryAssetPath)
                    ?? Resources.Load<DungeonAuthoredModuleRegistryV2>(DungeonAuthoredModuleRegistryV2.ResourcePath);
                if (registry == null)
                    throw new InvalidOperationException("Missing authored module registry at '" + RegistryAssetPath + "'.");
                if (!registry.ValidateCatalogCoverage(out IReadOnlyList<string> coverageErrors))
                    throw new InvalidOperationException("Registry coverage failed: " + string.Join(" | ", coverageErrors));

                var entries = new Dictionary<string, DungeonAuthoredModuleEntryV2>(StringComparer.Ordinal);
                var definitions = new Dictionary<string, IndustrialFactoryV2ModuleDefinition>(StringComparer.Ordinal);
                var geometries = new Dictionary<string, CertifiedDungeonModuleGeometryV2>(StringComparer.Ordinal);
                var sources = new List<DungeonAuthoredCaptureSourceV2>();
                foreach (DungeonAuthoredModuleEntryV2 entry in registry.Modules.OrderBy(value => value.TemplateId, StringComparer.Ordinal))
                {
                    if (entry == null || entry.PresentationPrefab == null)
                        throw new InvalidOperationException("Registry contains a missing authored presentation prefab.");
                    if (!entry.TryReadDefinition(out IndustrialFactoryV2ModuleDefinition definition,
                            out CertifiedDungeonModuleGeometryV2 geometry, out string error))
                        throw new InvalidOperationException("Cannot read module '" + entry.TemplateId + "': " + error);
                    ValidatePrefabForCapture(entry);
                    entries.Add(entry.TemplateId, entry);
                    definitions.Add(entry.TemplateId, definition);
                    geometries.Add(entry.TemplateId, geometry);
                    sources.Add(new DungeonAuthoredCaptureSourceV2(
                        entry.TemplateId,
                        definition.Composition.Archetype,
                        definition.Composition.Districts.Contains(DungeonBiomeDistrictKindV2.Waterworks),
                        definition.Composition.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom));
                }

                IReadOnlyList<DungeonAuthoredCaptureRequestV2> requests = DungeonAuthoredCapturePlanV2.Build(sources);
                PrepareOutputPaths(outputDirectory, requests);
                var results = new List<DungeonAuthoredCaptureManifestEntryV2>(requests.Count);
                foreach (IGrouping<string, DungeonAuthoredCaptureRequestV2> group in requests
                    .GroupBy(value => value.TemplateId, StringComparer.Ordinal)
                    .OrderBy(value => value.Key, StringComparer.Ordinal))
                {
                    CaptureModule(outputDirectory, entries[group.Key], definitions[group.Key], geometries[group.Key],
                        group.OrderBy(value => value.RelativePath, StringComparer.Ordinal), results);
                }

                DungeonAuthoredCaptureManifestEntryV2[] orderedResults = results
                    .OrderBy(value => value.relativePath, StringComparer.Ordinal).ToArray();
                if (orderedResults.Length != DungeonAuthoredCapturePlanV2.ExpectedCaptureCount)
                    throw new InvalidOperationException("Produced " + orderedResults.Length + " captures; expected 79.");
                var manifest = new DungeonAuthoredCaptureManifestV2
                {
                    contentPackId = registry.ContentPackId,
                    registryAssetPath = RegistryAssetPath,
                    width = CaptureWidth,
                    height = CaptureHeight,
                    captureCount = orderedResults.Length,
                    captures = orderedResults
                };
                string manifestPath = Path.Combine(outputDirectory, "capture-manifest.json");
                File.WriteAllText(manifestPath, JsonUtility.ToJson(manifest, true) + Environment.NewLine);
                return manifestPath;
            }
            catch (Exception exception)
            {
                File.WriteAllText(failurePath, exception.GetType().FullName + Environment.NewLine
                    + exception.Message + Environment.NewLine + exception.StackTrace + Environment.NewLine);
                throw;
            }
        }

        private static void CaptureModule(
            string outputDirectory,
            DungeonAuthoredModuleEntryV2 entry,
            IndustrialFactoryV2ModuleDefinition definition,
            CertifiedDungeonModuleGeometryV2 geometry,
            IEnumerable<DungeonAuthoredCaptureRequestV2> requests,
            ICollection<DungeonAuthoredCaptureManifestEntryV2> results)
        {
            Scene previewScene = EditorSceneManager.NewPreviewScene();
            try
            {
                GameObject module = PrefabUtility.InstantiatePrefab(entry.PresentationPrefab, previewScene) as GameObject;
                if (module == null)
                    throw new InvalidOperationException("Failed to instantiate exact prefab for '" + entry.TemplateId + "'.");
                module.name = entry.TemplateId + "__CAPTURE_INSTANCE";
                module.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                module.transform.localScale = Vector3.one;
                Renderer[] enabledRenderers = module.GetComponentsInChildren<Renderer>(true)
                    .Where(value => value.enabled && value.gameObject.activeInHierarchy)
                    .ToArray();
                if (enabledRenderers.Length == 0)
                    throw new InvalidOperationException("Exact prefab instance for '" + entry.TemplateId
                        + "' has no enabled presentation renderer.");
                if (enabledRenderers.Any(value => !IsFinite(value.bounds)))
                    throw new InvalidOperationException("Exact prefab instance for '" + entry.TemplateId
                        + "' has a renderer with invalid bounds.");

                GameObject rig = CreateSceneObject(previewScene, "__CAPTURE_RIG__");
                CloseUnusedSockets(module, rig.transform, previewScene);
                Camera camera = CreateCamera(rig.transform);
                Light key = CreateDirectionalLight(rig.transform);
                Light fill = CreatePointLight(rig.transform, "CaptureFill", new Vector3(-5f, 3.2f, -3f));
                Light rim = CreatePointLight(rig.transform, "CaptureRim", new Vector3(5f, 5f, 4f));
                var originalLightIntensities = module.GetComponentsInChildren<Light>(true)
                    .ToDictionary(value => value, value => value.intensity);

                foreach (DungeonAuthoredCaptureRequestV2 request in requests)
                {
                    ConfigurePresentationProfile(module, originalLightIntensities, key, fill, rim, request.Lighting);
                    CertifiedDungeonRegionGeometryV2 region = SelectRegion(geometry, request.Band);
                    CameraPoseV2 pose = FindSafeCameraPose(
                        previewScene, module, geometry, region, request, camera);
                    camera.transform.SetPositionAndRotation(
                        pose.Position, Quaternion.LookRotation(pose.Target - pose.Position, Vector3.up));
                    float clearFraction = ProbeForExteriorVoid(camera, request, entry.TemplateId);
                    string absolutePath = Path.Combine(
                        outputDirectory, request.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                    byte[] png = RenderPng(camera, CaptureWidth, CaptureHeight, CaptureBackground(request.Lighting));
                    File.WriteAllBytes(absolutePath, png);
                    results.Add(new DungeonAuthoredCaptureManifestEntryV2
                    {
                        templateId = entry.TemplateId,
                        moduleRevisionHash = entry.CombinedRevisionHash,
                        archetype = definition.Composition.Archetype.ToString(),
                        viewId = request.ViewId,
                        band = request.Band.ToString(),
                        lighting = request.Lighting.ToString(),
                        regionId = region.Id,
                        relativePath = request.RelativePath.Replace('\\', '/'),
                        cameraLocalPosition = FormatVector(pose.Position),
                        cameraLocalTarget = FormatVector(pose.Target),
                        clearPixelFraction = clearFraction,
                        sha256 = ComputeSha256(png)
                    });
                }
            }
            finally
            {
                EditorSceneManager.ClosePreviewScene(previewScene);
            }
        }

        private static void ValidatePrefabForCapture(DungeonAuthoredModuleEntryV2 entry)
        {
            GameObject prefab = entry.PresentationPrefab;
            if (PrefabUtility.GetPrefabAssetType(prefab) == PrefabAssetType.NotAPrefab)
                throw new InvalidOperationException("Presentation for '" + entry.TemplateId + "' is not a prefab asset.");
            DungeonModuleGeometryAuthoringV2 authoring = prefab.GetComponent<DungeonModuleGeometryAuthoringV2>();
            string hierarchyError = string.Empty;
            if (authoring == null || !authoring.HasAuthoredHierarchy(out hierarchyError))
                throw new InvalidOperationException("Invalid capture hierarchy for '" + entry.TemplateId + "': " + hierarchyError);
            DungeonAuthoredModuleValidationResultV2 validation =
                DungeonAuthoredModuleValidatorV2.Validate(prefab, requireCurrentBake: true);
            if (!validation.IsValid)
                throw new InvalidOperationException("Authored prefab '" + entry.TemplateId
                    + "' failed pre-capture validation: "
                    + string.Join(" | ", validation.Issues.Select(value => value.ToString())));
            Renderer[] renderers = authoring.PresentationRoot.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
                throw new InvalidOperationException("Authored prefab '" + entry.TemplateId + "' has no presentation renderers.");
            foreach (Renderer renderer in renderers)
            {
                if (renderer is MeshRenderer && renderer.GetComponent<MeshFilter>()?.sharedMesh == null)
                    throw new InvalidOperationException("Renderer '" + renderer.name + "' in '" + entry.TemplateId + "' has no mesh.");
                if (renderer.sharedMaterials == null || renderer.sharedMaterials.Length == 0
                    || renderer.sharedMaterials.Any(material => material == null || material.shader == null))
                    throw new InvalidOperationException("Renderer '" + renderer.name + "' has a missing material or shader.");
            }
        }

        private static void PrepareOutputPaths(
            string outputDirectory,
            IEnumerable<DungeonAuthoredCaptureRequestV2> requests)
        {
            foreach (DungeonAuthoredCaptureRequestV2 request in requests)
            {
                string path = Path.Combine(outputDirectory, request.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                string directory = Path.GetDirectoryName(path)
                    ?? throw new InvalidOperationException("Capture path has no directory: " + path);
                Directory.CreateDirectory(directory);
                if (File.Exists(path)) File.Delete(path);
            }
            string manifest = Path.Combine(outputDirectory, "capture-manifest.json");
            if (File.Exists(manifest)) File.Delete(manifest);
        }

        private static void CloseUnusedSockets(GameObject module, Transform rig, Scene scene)
        {
            foreach (DungeonConnectorGeometryAuthoringV2 connector in module
                .GetComponentsInChildren<DungeonConnectorGeometryAuthoringV2>(true)
                .OrderBy(value => value.StableId, StringComparer.Ordinal))
            {
                if (connector.CapState == DungeonConnectorCapStateV2.PermanentlyOpen) continue;
                if (connector.ThemedCapPrefab == null)
                    throw new InvalidOperationException("Connector '" + connector.StableId + "' requires a themed cap.");
                GameObject cap = PrefabUtility.InstantiatePrefab(connector.ThemedCapPrefab, scene) as GameObject;
                if (cap == null || cap.GetComponentsInChildren<Renderer>(true).Length == 0)
                {
                    if (cap != null) UnityEngine.Object.DestroyImmediate(cap);
                    throw new InvalidOperationException("Connector '" + connector.StableId + "' has an invalid cap prefab.");
                }
                cap.name = "CaptureCap__" + connector.StableId;
                cap.transform.SetParent(rig, true);
                cap.transform.SetPositionAndRotation(connector.transform.position, connector.transform.rotation);
            }
        }

        private static CertifiedDungeonRegionGeometryV2 SelectRegion(
            CertifiedDungeonModuleGeometryV2 geometry,
            DungeonAuthoredCaptureBandV2 band)
        {
            DungeonElevationStratumV2 preferred = band == DungeonAuthoredCaptureBandV2.Upper
                ? DungeonElevationStratumV2.Upper
                : band == DungeonAuthoredCaptureBandV2.Lower
                    ? DungeonElevationStratumV2.Lower
                    : DungeonElevationStratumV2.Entry;
            CertifiedDungeonRegionGeometryV2 exact = geometry.Regions
                .Where(value => value.ElevationStratum == preferred)
                .OrderBy(value => value.Id, StringComparer.Ordinal).FirstOrDefault();
            if (exact != null) return exact;
            Func<CertifiedDungeonRegionGeometryV2, double> centerY = value =>
                (value.Bounds.Minimum.Y + value.Bounds.Maximum.Y) * 0.5d;
            if (band == DungeonAuthoredCaptureBandV2.Upper)
                return geometry.Regions.OrderByDescending(centerY).ThenBy(value => value.Id, StringComparer.Ordinal).First();
            if (band == DungeonAuthoredCaptureBandV2.Lower)
                return geometry.Regions.OrderBy(centerY).ThenBy(value => value.Id, StringComparer.Ordinal).First();
            return geometry.Regions.OrderBy(value => Math.Abs(centerY(value)))
                .ThenBy(value => value.Id, StringComparer.Ordinal).First();
        }

        private static CameraPoseV2 FindSafeCameraPose(
            Scene scene,
            GameObject module,
            CertifiedDungeonModuleGeometryV2 geometry,
            CertifiedDungeonRegionGeometryV2 region,
            DungeonAuthoredCaptureRequestV2 request,
            Camera camera)
        {
            CertifiedDungeonSurfaceGeometryV2 walkable = geometry.Surfaces
                .Where(value => value.IsWalkable && string.Equals(value.RegionId, region.Id, StringComparison.Ordinal))
                .OrderByDescending(SurfaceArea).ThenBy(value => value.Id, StringComparer.Ordinal).FirstOrDefault();
            if (walkable == null)
                throw new InvalidOperationException("Region '" + region.Id + "' has no walkable capture surface.");
            Bounds bounds = ToUnityBounds(region.Bounds);
            Vector3 target = SurfaceCenter(walkable);
            float floorY = (float)walkable.Volume.MaximumY;
            target.y = floorY + 1.20f;
            target.x = Mathf.Clamp(target.x, bounds.min.x + 0.8f, bounds.max.x - 0.8f);
            target.z = Mathf.Clamp(target.z, bounds.min.z + 0.8f, bounds.max.z - 0.8f);
            Vector2[] directions =
            {
                new Vector2(0f, -1f), new Vector2(-0.7071f, -0.7071f),
                new Vector2(-1f, 0f), new Vector2(-0.7071f, 0.7071f),
                new Vector2(0f, 1f), new Vector2(0.7071f, 0.7071f),
                new Vector2(1f, 0f), new Vector2(0.7071f, -0.7071f)
            };
            int rotation = ((int)request.Band * 2 + StableOrdinal(request.ViewId)) % directions.Length;
            var failures = new List<string>();
            Physics.SyncTransforms();
            for (int offset = 0; offset < directions.Length; offset += 1)
            {
                Vector2 direction = directions[(offset + rotation) % directions.Length];
                for (int distanceIndex = 0; distanceIndex < 3; distanceIndex += 1)
                {
                    float distance = 7f - distanceIndex * 1.35f;
                    Vector3 position = target + new Vector3(direction.x * distance, 2.15f, direction.y * distance);
                    position.x = Mathf.Clamp(position.x, bounds.min.x + 0.55f, bounds.max.x - 0.55f);
                    position.y = Mathf.Clamp(position.y, floorY + 1.65f, bounds.max.y - 0.45f);
                    position.z = Mathf.Clamp(position.z, bounds.min.z + 0.55f, bounds.max.z - 0.55f);
                    var candidate = new CameraPoseV2(position, target);
                    if (!TryValidateCameraGeometry(scene, geometry, candidate, camera, out string error))
                    {
                        failures.Add(error);
                        continue;
                    }
                    camera.transform.SetPositionAndRotation(
                        candidate.Position, Quaternion.LookRotation(candidate.Target - candidate.Position, Vector3.up));
                    try
                    {
                        ProbeForExteriorVoid(camera, request, module.name);
                        return candidate;
                    }
                    catch (InvalidOperationException exception)
                    {
                        failures.Add(exception.Message);
                    }
                }
            }
            throw new InvalidOperationException("No sealed gameplay-distance camera pose exists for '" + module.name
                + "' / '" + request.ViewId + "' in region '" + region.Id + "'. "
                + string.Join(" | ", failures.Distinct().Take(6)));
        }

        private static bool TryValidateCameraGeometry(
            Scene scene,
            CertifiedDungeonModuleGeometryV2 geometry,
            CameraPoseV2 pose,
            Camera camera,
            out string error)
        {
            if ((pose.Target - pose.Position).sqrMagnitude < 9f)
            {
                error = "Camera is closer than gameplay distance.";
                return false;
            }
            if (!ContainsAnyRegion(geometry, pose.Position, 0.20f))
            {
                error = "Camera origin leaves certified region volume.";
                return false;
            }
            camera.transform.SetPositionAndRotation(
                pose.Position, Quaternion.LookRotation(pose.Target - pose.Position, Vector3.up));
            var corners = new Vector3[4];
            camera.CalculateFrustumCorners(new Rect(0f, 0f, 1f, 1f), camera.nearClipPlane,
                Camera.MonoOrStereoscopicEye.Mono, corners);
            if (corners.Select(camera.transform.TransformPoint).Any(corner => !ContainsAnyRegion(geometry, corner, 0.02f)))
            {
                error = "Camera near plane leaves certified region volume.";
                return false;
            }
            var overlaps = new Collider[16];
            if (scene.GetPhysicsScene().OverlapSphere(
                    pose.Position, 0.22f, overlaps, ~0, QueryTriggerInteraction.Ignore) > 0)
            {
                error = "Camera sphere intersects certified collision.";
                return false;
            }
            Vector3 sightline = pose.Target - pose.Position;
            if (scene.GetPhysicsScene().Raycast(
                    pose.Position,
                    sightline.normalized,
                    out RaycastHit blocked,
                    sightline.magnitude - 0.15f,
                    ~0,
                    QueryTriggerInteraction.Ignore))
            {
                error = "Certified collision blocks the camera target at '" + blocked.collider.name + "'.";
                return false;
            }
            Vector3 screen = camera.WorldToViewportPoint(pose.Target);
            if (screen.z <= 0f || screen.x < 0.1f || screen.x > 0.9f || screen.y < 0.1f || screen.y > 0.9f)
            {
                error = "Camera target is outside the safe viewport.";
                return false;
            }
            error = string.Empty;
            return true;
        }

        private static float ProbeForExteriorVoid(
            Camera camera,
            DungeonAuthoredCaptureRequestV2 request,
            string templateId)
        {
            Color32[] pixels = RenderPixels(camera, ProbeWidth, ProbeHeight, SentinelColor);
            int clearPixels = pixels.Count(pixel => pixel.r >= 250 && pixel.g <= 5 && pixel.b >= 250);
            float fraction = clearPixels / (float)pixels.Length;
            if (fraction > MaximumClearPixelFraction)
                throw new InvalidOperationException("Void-facing camera setup for '" + templateId + "' / '"
                    + request.ViewId + "': " + clearPixels + " clear pixels ("
                    + fraction.ToString("P3", CultureInfo.InvariantCulture) + ").");
            return fraction;
        }

        private static void ConfigurePresentationProfile(
            GameObject module,
            IReadOnlyDictionary<Light, float> originals,
            Light key,
            Light fill,
            Light rim,
            DungeonAuthoredCaptureLightingV2 profile)
        {
            LightingValues values = LightingValues.For(profile);
            foreach (KeyValuePair<Light, float> pair in originals)
                pair.Key.intensity = pair.Value * values.AuthoredScale;
            ApplyLight(key, values.KeyColor, values.KeyIntensity);
            ApplyLight(fill, values.FillColor, values.FillIntensity);
            ApplyLight(rim, values.RimColor, values.RimIntensity);

            float phase = profile == DungeonAuthoredCaptureLightingV2.ElectricCharge ? 1f
                : profile == DungeonAuthoredCaptureLightingV2.ElectricLive ? 2f
                : profile == DungeonAuthoredCaptureLightingV2.ElectricSafe ? 0f : -1f;
            foreach (Renderer renderer in module.GetComponentsInChildren<Renderer>(true))
            {
                Material[] materials = renderer.sharedMaterials;
                bool electric = HasShader(materials, "Ruin/ElectricPanel");
                bool magma = HasShader(materials, "Ruin/MagmaSurface");
                bool water = HasShader(materials, "Ruin/WaterSurface");
                if (!electric && !magma && !water) continue;
                var block = new MaterialPropertyBlock();
                renderer.GetPropertyBlock(block);
                if (electric)
                {
                    Material source = materials.First(material => material != null && material.shader != null
                        && string.Equals(material.shader.name, "Ruin/ElectricPanel", StringComparison.Ordinal));
                    block.SetFloat("_Phase", phase >= 0f ? phase : source.GetFloat("_Phase"));
                    block.SetFloat("_PulseSpeed", 0f);
                }
                if (magma) block.SetFloat("_PulseSpeed", 0f);
                if (magma || water)
                {
                    block.SetVector("_ScrollA", Vector4.zero);
                    block.SetVector("_ScrollB", Vector4.zero);
                }
                renderer.SetPropertyBlock(block);
            }
        }

        private static bool HasShader(IEnumerable<Material> materials, string shaderName) =>
            materials.Any(material => material != null && material.shader != null
                && string.Equals(material.shader.name, shaderName, StringComparison.Ordinal));

        private static void ApplyLight(Light light, Color color, float intensity)
        {
            light.color = color;
            light.intensity = intensity;
        }

        private static Camera CreateCamera(Transform parent)
        {
            var target = new GameObject("AuthoredDungeonV2CaptureCamera");
            target.transform.SetParent(parent, false);
            Camera camera = target.AddComponent<Camera>();
            camera.fieldOfView = 58f;
            camera.aspect = CaptureWidth / (float)CaptureHeight;
            camera.nearClipPlane = 0.18f;
            camera.farClipPlane = 90f;
            camera.allowHDR = false;
            camera.allowMSAA = true;
            camera.clearFlags = CameraClearFlags.SolidColor;
            return camera;
        }

        private static Light CreateDirectionalLight(Transform parent)
        {
            var target = new GameObject("CaptureKey");
            target.transform.SetParent(parent, false);
            target.transform.rotation = Quaternion.Euler(48f, -32f, 0f);
            Light light = target.AddComponent<Light>();
            light.type = LightType.Directional;
            light.shadows = LightShadows.Soft;
            light.shadowStrength = 0.55f;
            return light;
        }

        private static Light CreatePointLight(Transform parent, string name, Vector3 position)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            target.transform.localPosition = position;
            Light light = target.AddComponent<Light>();
            light.type = LightType.Point;
            light.range = 24f;
            light.shadows = LightShadows.None;
            return light;
        }

        private static GameObject CreateSceneObject(Scene scene, string name)
        {
            var target = new GameObject(name);
            SceneManager.MoveGameObjectToScene(target, scene);
            return target;
        }

        private static byte[] RenderPng(Camera camera, int width, int height, Color background)
        {
            Color32[] pixels = RenderPixels(camera, width, height, background);
            var texture = new Texture2D(width, height, TextureFormat.RGB24, false, false);
            try
            {
                texture.SetPixels32(pixels);
                texture.Apply(false, false);
                return texture.EncodeToPNG();
            }
            finally { UnityEngine.Object.DestroyImmediate(texture); }
        }

        private static Color32[] RenderPixels(Camera camera, int width, int height, Color background)
        {
            RenderTexture previousActive = RenderTexture.active;
            RenderTexture previousTarget = camera.targetTexture;
            Color previousBackground = camera.backgroundColor;
            var renderTexture = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32)
            {
                antiAliasing = 1,
                useMipMap = false,
                autoGenerateMips = false
            };
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false, false);
            try
            {
                renderTexture.Create();
                camera.targetTexture = renderTexture;
                camera.backgroundColor = background;
                RenderTexture.active = renderTexture;
                camera.Render();
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
                texture.Apply(false, false);
                return texture.GetPixels32();
            }
            finally
            {
                camera.targetTexture = previousTarget;
                camera.backgroundColor = previousBackground;
                RenderTexture.active = previousActive;
                renderTexture.Release();
                UnityEngine.Object.DestroyImmediate(renderTexture);
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static Color CaptureBackground(DungeonAuthoredCaptureLightingV2 profile)
        {
            switch (profile)
            {
                case DungeonAuthoredCaptureLightingV2.Bright: return new Color(0.16f, 0.21f, 0.27f, 1f);
                case DungeonAuthoredCaptureLightingV2.Magma: return new Color(0.035f, 0.010f, 0.006f, 1f);
                case DungeonAuthoredCaptureLightingV2.Waterworks: return new Color(0.008f, 0.035f, 0.055f, 1f);
                case DungeonAuthoredCaptureLightingV2.ElectricCharge: return new Color(0.035f, 0.018f, 0.008f, 1f);
                case DungeonAuthoredCaptureLightingV2.ElectricLive: return new Color(0.005f, 0.018f, 0.045f, 1f);
                default: return new Color(0.008f, 0.012f, 0.020f, 1f);
            }
        }

        private static float SurfaceArea(CertifiedDungeonSurfaceGeometryV2 surface)
        {
            double minX = surface.Volume.HorizontalVertices.Min(value => value.X);
            double maxX = surface.Volume.HorizontalVertices.Max(value => value.X);
            double minZ = surface.Volume.HorizontalVertices.Min(value => value.Z);
            double maxZ = surface.Volume.HorizontalVertices.Max(value => value.Z);
            return (float)Math.Max(0d, (maxX - minX) * (maxZ - minZ));
        }

        private static Vector3 SurfaceCenter(CertifiedDungeonSurfaceGeometryV2 surface) => new Vector3(
            -(float)surface.Volume.HorizontalVertices.Average(value => value.X),
            (float)surface.Volume.MaximumY,
            (float)surface.Volume.HorizontalVertices.Average(value => value.Z));

        private static Bounds ToUnityBounds(DungeonBounds3 core)
        {
            var result = new Bounds();
            result.SetMinMax(
                new Vector3(-(float)core.Maximum.X, (float)core.Minimum.Y, (float)core.Minimum.Z),
                new Vector3(-(float)core.Minimum.X, (float)core.Maximum.Y, (float)core.Maximum.Z));
            return result;
        }

        private static bool ContainsAnyRegion(
            CertifiedDungeonModuleGeometryV2 geometry,
            Vector3 point,
            float margin)
        {
            foreach (CertifiedDungeonRegionGeometryV2 region in geometry.Regions)
            {
                Bounds bounds = ToUnityBounds(region.Bounds);
                bounds.Expand(-margin * 2f);
                if (bounds.Contains(point)) return true;
            }
            return false;
        }

        private static int StableOrdinal(string value)
        {
            unchecked
            {
                int hash = 17;
                foreach (char character in value ?? string.Empty) hash = hash * 31 + character;
                return Math.Abs(hash == int.MinValue ? 0 : hash);
            }
        }

        private static string FormatVector(Vector3 value) =>
            value.x.ToString("0.000", CultureInfo.InvariantCulture) + ","
            + value.y.ToString("0.000", CultureInfo.InvariantCulture) + ","
            + value.z.ToString("0.000", CultureInfo.InvariantCulture);

        private static string ComputeSha256(byte[] value)
        {
            using (SHA256 algorithm = SHA256.Create())
                return "sha256:" + string.Concat(algorithm.ComputeHash(value)
                    .Select(item => item.ToString("x2", CultureInfo.InvariantCulture)));
        }

        private static bool IsFinite(Bounds bounds) =>
            IsFinite(bounds.center.x) && IsFinite(bounds.center.y) && IsFinite(bounds.center.z)
            && IsFinite(bounds.size.x) && IsFinite(bounds.size.y) && IsFinite(bounds.size.z);

        private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

        private readonly struct CameraPoseV2
        {
            public CameraPoseV2(Vector3 position, Vector3 target)
            {
                Position = position;
                Target = target;
            }
            public Vector3 Position { get; }
            public Vector3 Target { get; }
        }

        private readonly struct LightingValues
        {
            public LightingValues(float scale, Color key, float keyIntensity, Color fill, float fillIntensity,
                Color rim, float rimIntensity)
            {
                AuthoredScale = scale;
                KeyColor = key;
                KeyIntensity = keyIntensity;
                FillColor = fill;
                FillIntensity = fillIntensity;
                RimColor = rim;
                RimIntensity = rimIntensity;
            }
            public float AuthoredScale { get; }
            public Color KeyColor { get; }
            public float KeyIntensity { get; }
            public Color FillColor { get; }
            public float FillIntensity { get; }
            public Color RimColor { get; }
            public float RimIntensity { get; }

            public static LightingValues For(DungeonAuthoredCaptureLightingV2 profile)
            {
                switch (profile)
                {
                    case DungeonAuthoredCaptureLightingV2.Bright:
                        return new LightingValues(1.20f, C(0.78f, 0.88f, 1f), 1.05f,
                            C(0.32f, 0.92f, 0.86f), 1.20f, C(1f, 0.62f, 0.28f), 0.85f);
                    case DungeonAuthoredCaptureLightingV2.Dark:
                        return new LightingValues(0.16f, C(0.26f, 0.38f, 0.58f), 0.20f,
                            C(0.08f, 0.38f, 0.46f), 0.28f, C(0.52f, 0.22f, 0.08f), 0.16f);
                    case DungeonAuthoredCaptureLightingV2.Waterworks:
                        return new LightingValues(0.75f, C(0.20f, 0.68f, 0.90f), 0.55f,
                            C(0.08f, 0.85f, 0.82f), 1.15f, C(0.13f, 0.38f, 0.78f), 0.85f);
                    case DungeonAuthoredCaptureLightingV2.Magma:
                        return new LightingValues(0.70f, C(1f, 0.38f, 0.08f), 0.48f,
                            C(1f, 0.12f, 0.02f), 1.75f, C(1f, 0.72f, 0.20f), 1.20f);
                    case DungeonAuthoredCaptureLightingV2.ElectricCharge:
                        return new LightingValues(0.65f, C(1f, 0.42f, 0.08f), 0.45f,
                            C(1f, 0.18f, 0.04f), 1.15f, C(0.42f, 0.70f, 1f), 0.65f);
                    case DungeonAuthoredCaptureLightingV2.ElectricLive:
                        return new LightingValues(0.90f, C(0.32f, 0.68f, 1f), 0.70f,
                            C(0.08f, 0.95f, 1f), 1.80f, C(0.72f, 0.32f, 1f), 1.15f);
                    case DungeonAuthoredCaptureLightingV2.ElectricSafe:
                        return new LightingValues(0.45f, C(0.28f, 0.46f, 0.68f), 0.35f,
                            C(0.08f, 0.50f, 0.58f), 0.45f, C(0.16f, 0.32f, 0.58f), 0.30f);
                    default:
                        return new LightingValues(0.75f, C(0.58f, 0.72f, 0.86f), 0.48f,
                            C(0.10f, 0.70f, 0.68f), 0.72f, C(1f, 0.42f, 0.12f), 0.55f);
                }
            }

            private static Color C(float r, float g, float b) => new Color(r, g, b, 1f);
        }
    }
}
