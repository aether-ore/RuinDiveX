using System;
using System.Linq;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    /// <summary>
    /// Disposable, unsaved visual-QA stage used by Unity MCP captures. The
    /// stage is offset from the active production scene and never saves scene
    /// state. It intentionally reuses the production V2 builder.
    /// </summary>
    public static class DungeonV2PresentationCaptureStage
    {
        private const string StageName = "__V2_PRESENTATION_CAPTURE_STAGE__";
        private const string CameraName = "V2 Presentation Capture Camera";
        private static readonly Vector3 StageOffset = new Vector3(500f, 0f, 500f);

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Waterworks Stage")]
        public static void BuildWaterworksStage()
        {
            BuildWaterworksConfiguration(IndustrialFactoryV2Ruleset.FreightSumpFilled, "WATERWORKS // FREIGHT SUMP FILLED");
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Waterworks Drained Stage")]
        public static void BuildWaterworksDrainedStage()
        {
            BuildWaterworksConfiguration(IndustrialFactoryV2Ruleset.StoredInReservoir, "WATERWORKS // FREIGHT SUMP DRAINED");
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Waterworks Routing Console Stage")]
        public static void BuildWaterworksRoutingConsoleStage()
        {
            DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
            DungeonFluidNetworkPlanV2 network = plan.FluidNetworks.Single();
            var snapshot = new DungeonEnvironmentSnapshotV2(
                Array.Empty<DungeonControllerStateFactV2>(),
                new[]
                {
                    new DungeonFluidNetworkStateV2(
                        network.Id,
                        IndustrialFactoryV2Ruleset.FreightSumpFilled)
                },
                Array.Empty<string>());
            DungeonSceneBuilderV2 builder = BuildStage(plan, snapshot);
            DungeonEnvironmentConsoleRuntimeV2 console = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                .FirstOrDefault(value => string.Equals(
                    value.ControllerId,
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    StringComparison.Ordinal));
            if (console == null)
            {
                throw new InvalidOperationException("The V2 capture fixture has no Waterworks routing console.");
            }

            Bounds bounds = HierarchyRendererBounds(console.gameObject);
            bounds.Expand(new Vector3(9f, 4f, 9f));
            Frame(bounds, new Color(0.028f, 0.075f, 0.105f, 1f),
                "WATERWORKS // MASTER ROUTING CONSOLE");
            Selection.activeGameObject = console.gameObject;
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build District Strata Overview Stage")]
        public static void BuildDistrictStrataOverviewStage()
        {
            DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
            DungeonSceneBuilderV2 builder = BuildStage(plan);
            SetGeneratedRenderersEnabled(builder, false);
            var districtKinds = plan.Districts.ToDictionary(value => value.Id, value => value.Kind, StringComparer.Ordinal);
            var regionById = plan.Regions.ToDictionary(value => value.Id, StringComparer.Ordinal);
            GameObject overview = new GameObject("CertifiedDistrictStrataOverview");
            overview.transform.SetParent(GameObject.Find(StageName).transform, false);

            foreach (DungeonRegionPlanV2 region in plan.Regions)
            {
                DungeonPoint3 minimum = region.Bounds.Minimum;
                DungeonPoint3 maximum = region.Bounds.Maximum;
                Vector3 center = DungeonUnityCoordinates.ToUnity(
                    (minimum.X + maximum.X) * 0.5d,
                    minimum.Y + 0.12d,
                    (minimum.Z + maximum.Z) * 0.5d);
                Vector3 scale = new Vector3(
                    Mathf.Max(0.4f, (float)(maximum.X - minimum.X) - 0.18f),
                    0.20f,
                    Mathf.Max(0.4f, (float)(maximum.Z - minimum.Z) - 0.18f));
                Color color = DistrictColor(districtKinds[region.BiomeDistrictId]);
                GameObject plate = CreateCaptureCube(
                    "RegionPlate_" + region.Id,
                    overview.transform,
                    center,
                    scale,
                    color);
                AddCaptureLabel(
                    plate.transform,
                    region.ElevationStratum.ToString().ToUpperInvariant() + " // " + ShortRegionId(region.Id),
                    new Vector3(0f, 0.32f, 0f),
                    0.034f,
                    Color.white);
            }

            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                if (!regionById.TryGetValue(edge.FromRegionId, out DungeonRegionPlanV2 from)
                    || !regionById.TryGetValue(edge.ToRegionId, out DungeonRegionPlanV2 to))
                {
                    continue;
                }
                Vector3 start = RegionCenter(from) + Vector3.up * 0.40f;
                Vector3 end = RegionCenter(to) + Vector3.up * 0.40f;
                CreateCaptureLine(
                    "Traversal_" + edge.Id,
                    overview.transform,
                    start,
                    end,
                    edge.IsProtectedProgressionBoundary
                        ? new Color(1f, 0.32f, 0.22f, 1f)
                        : new Color(0.20f, 0.94f, 1f, 1f),
                    edge.IsProtectedProgressionBoundary ? 0.18f : 0.10f);
            }

            Bounds bounds = HierarchyRendererBounds(overview);
            AddStratumLegend(overview.transform, bounds);
            Frame(bounds, new Color(0.018f, 0.025f, 0.050f, 1f),
                "GENERATED DISTRICT OVERVIEW // LOWER + ENTRY + UPPER");
            Selection.activeGameObject = overview;
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Layered Minimap Entry Stage")]
        public static void BuildLayeredMinimapEntryStage()
        {
            DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
            DungeonSceneBuilderV2 builder = BuildStage(plan);
            SetGeneratedRenderersEnabled(builder, false);
            DungeonLayeredMinimapComponentV2 minimap = builder.CurrentInstance.Minimap;
            foreach (DungeonRegionPlanV2 region in plan.Regions)
            {
                minimap.SeeRegion(region.Id);
            }
            foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges)
            {
                minimap.RevealConnection(edge.Id);
            }
            foreach (DungeonRegionPlanV2 region in plan.Regions
                .Where(value => value.ElevationStratum == DungeonElevationStratumV2.Entry)
                .Take(3))
            {
                minimap.VisitRegion(region.Id);
            }
            foreach (DungeonAnchorPlanV2 anchor in plan.Anchors
                .Where(value => value.Kind == DungeonAnchorKindV2.Landmark
                    || value.Kind == DungeonAnchorKindV2.Console))
            {
                minimap.SurveyAnchor(anchor.Id);
            }

            DungeonLayeredMinimapViewStateV2 view = minimap.ViewState;
            GameObject panel = BuildLayeredMinimapPanel(plan, view);
            Camera camera = GameObject.Find(CameraName).GetComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 6.15f;
            camera.transform.position = StageOffset + new Vector3(0f, 0f, -20f);
            camera.transform.rotation = Quaternion.identity;
            camera.backgroundColor = new Color(0.014f, 0.028f, 0.060f, 1f);
            OrientLabels();
            Selection.activeGameObject = panel;
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Magma Bright Stage")]
        public static void BuildMagmaBrightStage()
        {
            BuildMagmaStage(new Color(0.58f, 0.62f, 0.66f, 1f), "MAGMA UNDERCROFT // BRIGHT ENVIRONMENT");
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Magma Dark Stage")]
        public static void BuildMagmaDarkStage()
        {
            BuildMagmaStage(new Color(0.016f, 0.018f, 0.025f, 1f), "MAGMA UNDERCROFT // DARK ENVIRONMENT");
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Set Magma Dark Lighting")]
        public static void SetMagmaDarkLighting()
        {
            Camera camera = GameObject.Find(CameraName)?.GetComponent<Camera>();
            GameObject stage = GameObject.Find(StageName);
            if (camera == null || stage == null)
            {
                throw new InvalidOperationException("Build the Magma Bright capture stage first.");
            }

            camera.backgroundColor = new Color(0.016f, 0.018f, 0.025f, 1f);
            Light key = stage.GetComponentsInChildren<Light>(true)
                .FirstOrDefault(value => value.gameObject.name == "CaptureKeyLight");
            Light fill = stage.GetComponentsInChildren<Light>(true)
                .FirstOrDefault(value => value.gameObject.name == "CaptureFillLight");
            if (key != null)
            {
                key.intensity = 0.24f;
                key.color = new Color(0.52f, 0.62f, 0.78f, 1f);
            }
            if (fill != null)
            {
                fill.intensity = 0.34f;
                fill.color = new Color(0.32f, 0.44f, 0.66f, 1f);
            }

            SetCaptureTitle("MAGMA UNDERCROFT // DARK ENVIRONMENT");
            OrientLabels();
            SceneView.RepaintAll();
        }

        private static void BuildWaterworksConfiguration(string configurationId, string title)
        {
            DungeonPlanV2 plan = FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
            DungeonFluidNetworkPlanV2 network = plan.FluidNetworks.Single();
            var snapshot = new DungeonEnvironmentSnapshotV2(
                Array.Empty<DungeonControllerStateFactV2>(),
                new[] { new DungeonFluidNetworkStateV2(network.Id, configurationId) },
                Array.Empty<string>());
            DungeonSceneBuilderV2 builder = BuildStage(plan, snapshot);
            DungeonFluidSurfacePresentationV2 fluid = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonFluidSurfacePresentationV2>(true)
                .FirstOrDefault(value => value.gameObject.activeInHierarchy)
                ?? builder.GeneratedRoot.GetComponentsInChildren<DungeonFluidSurfacePresentationV2>(true).FirstOrDefault();
            if (fluid == null)
            {
                throw new InvalidOperationException("The V2 capture fixture has no Waterworks volume.");
            }

            Renderer renderer = fluid.GetComponent<Renderer>();
            Frame(DistrictBounds(builder, DungeonBiomeDistrictKindV2.Waterworks),
                new Color(0.028f, 0.075f, 0.105f, 1f), title);
            Selection.activeGameObject = fluid.gameObject;
        }

        private static void BuildMagmaStage(Color background, string title)
        {
            DungeonSceneBuilderV2 builder = BuildStage(FindPlan(DungeonBiomeDistrictKindV2.MagmaUndercroft));
            DungeonHazardSurfaceCueV2 cue = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonHazardSurfaceCueV2>(true)
                .First(value => value.Kind == DungeonHazardSurfaceKindV2.Magma);
            Frame(cue.GetComponent<Renderer>().bounds, background, title);
            Selection.activeGameObject = cue.gameObject;
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Build Electric Safe Stage")]
        public static void BuildElectricSafeStage()
        {
            DungeonSceneBuilderV2 builder = BuildStage(FindPlan(DungeonBiomeDistrictKindV2.ElectricalUndercroft));
            DungeonHazardSurfaceCueV2 cue = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonHazardSurfaceCueV2>(true)
                .First(value => value.Kind == DungeonHazardSurfaceKindV2.Electric);
            DungeonHazardDistrictRuntimeV2 district = cue.GetComponentInParent<DungeonHazardDistrictRuntimeV2>();
            if (district == null)
            {
                district = builder.GeneratedRoot.GetComponentsInChildren<DungeonHazardDistrictRuntimeV2>(true)
                    .First(value => value.Kind == DungeonHazardSurfaceKindV2.Electric);
            }

            district.SetAutomaticSimulation(false);
            Renderer renderer = cue.GetComponent<Renderer>();
            Frame(renderer.bounds, new Color(0.018f, 0.025f, 0.050f, 1f), "ELECTRICAL UNDERCROFT // SAFE");
            Selection.activeGameObject = cue.gameObject;
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Set Electric Charging")]
        public static void SetElectricCharging()
        {
            DungeonHazardDistrictRuntimeV2 district = RequireElectricDistrict();
            if (district.VisualPhase == DungeonHazardVisualPhaseV2.ElectricSafe)
            {
                district.AdvanceSimulation(1.30d);
            }

            SetCaptureTitle("ELECTRICAL UNDERCROFT // CHARGING");
            OrientLabels();
            SceneView.RepaintAll();
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Set Electric Live")]
        public static void SetElectricLive()
        {
            DungeonHazardDistrictRuntimeV2 district = RequireElectricDistrict();
            // Capture workflow calls this after Charging. Advancing a full
            // second lands safely inside the 1.5-second energized window and
            // remains energized if the menu item is invoked twice.
            district.AdvanceSimulation(1.0d);

            SetCaptureTitle("ELECTRICAL UNDERCROFT // ENERGIZED");
            OrientLabels();
            SceneView.RepaintAll();
        }

        [MenuItem("Ruin Crawler/Porting/V2 Capture/Remove Capture Stage")]
        public static void RemoveStage()
        {
            GameObject existing = GameObject.Find(StageName);
            if (existing != null)
            {
                UnityEngine.Object.DestroyImmediate(existing);
            }
        }

        private static DungeonSceneBuilderV2 BuildStage(
            DungeonPlanV2 plan,
            DungeonEnvironmentSnapshotV2 snapshot = null)
        {
            RemoveStage();
            var stage = new GameObject(StageName);
            stage.hideFlags = HideFlags.DontSave;
            stage.transform.position = StageOffset;
            DungeonSceneBuilderV2 builder = stage.AddComponent<DungeonSceneBuilderV2>();
            if (!builder.TryBuild(plan, snapshot, null, out string error))
            {
                UnityEngine.Object.DestroyImmediate(stage);
                throw new InvalidOperationException(error);
            }

            GameObject cameraObject = new GameObject(CameraName);
            cameraObject.tag = "MainCamera";
            cameraObject.transform.SetParent(stage.transform, true);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 54f;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 300f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.allowHDR = true;

            GameObject key = new GameObject("CaptureKeyLight");
            key.transform.SetParent(stage.transform, false);
            key.transform.localRotation = Quaternion.Euler(52f, -38f, 0f);
            Light directional = key.AddComponent<Light>();
            directional.type = LightType.Directional;
            directional.intensity = 0.90f;
            directional.color = new Color(0.78f, 0.88f, 1f, 1f);
            directional.shadows = LightShadows.Soft;

            return builder;
        }

        private static void Frame(Bounds bounds, Color background, string title)
        {
            Camera camera = GameObject.Find(CameraName).GetComponent<Camera>();
            HideTallCaptureOccluders(bounds);
            CreatePlayerScaleReference(bounds);
            float radius = Mathf.Max(10.5f, Mathf.Max(bounds.size.x, bounds.size.z) * 0.68f);
            Vector3 focus = bounds.center + Vector3.up * 0.45f;
            camera.transform.position = focus + new Vector3(-radius * 0.72f, radius * 0.66f, -radius * 0.82f);
            camera.transform.rotation = Quaternion.LookRotation(focus - camera.transform.position, Vector3.up);
            camera.backgroundColor = background;

            GameObject fill = new GameObject("CaptureFillLight");
            fill.transform.SetParent(GameObject.Find(StageName).transform, true);
            fill.transform.position = focus + new Vector3(0f, 4.5f, -2f);
            Light light = fill.AddComponent<Light>();
            light.type = LightType.Point;
            light.range = radius * 2.5f;
            light.intensity = 1.45f;
            light.color = new Color(0.48f, 0.78f, 1f, 1f);

            GameObject titleObject = new GameObject("CaptureTitle");
            titleObject.transform.SetParent(GameObject.Find(StageName).transform, true);
            titleObject.transform.position = focus + Vector3.up * Mathf.Max(2.5f, bounds.size.y + 1.2f);
            TextMesh text = titleObject.AddComponent<TextMesh>();
            text.text = title;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.fontSize = 64;
            text.characterSize = 0.055f;
            text.color = new Color(0.82f, 0.96f, 1f, 1f);
            OrientLabels();
        }

        private static void HideTallCaptureOccluders(Bounds focusBounds)
        {
            GameObject stage = GameObject.Find(StageName);
            if (stage == null) return;
            foreach (MeshRenderer renderer in stage.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (renderer.bounds.size.y > 1.25f
                    && renderer.bounds.min.y < focusBounds.max.y + 2f
                    && renderer.bounds.max.y > focusBounds.min.y)
                {
                    renderer.enabled = false;
                }
            }
        }

        private static Bounds DistrictBounds(
            DungeonSceneBuilderV2 builder,
            DungeonBiomeDistrictKindV2 districtKind)
        {
            Renderer[] renderers = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonSurfacePresentationV2>(true)
                .Where(value => value.DistrictKind == districtKind && value.gameObject.activeInHierarchy)
                .Select(value => value.GetComponent<Renderer>())
                .Where(value => value != null)
                .ToArray();
            if (renderers.Length == 0)
            {
                throw new InvalidOperationException("No active surface presentation exists for district " + districtKind + ".");
            }

            Bounds bounds = renderers[0].bounds;
            for (int index = 1; index < renderers.Length; index += 1)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }

            return bounds;
        }

        private static Bounds HierarchyRendererBounds(GameObject root)
        {
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                return new Bounds(root.transform.position, Vector3.one);
            }

            Bounds bounds = renderers[0].bounds;
            for (int index = 1; index < renderers.Length; index += 1)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }
            return bounds;
        }

        private static GameObject BuildLayeredMinimapPanel(
            DungeonPlanV2 plan,
            DungeonLayeredMinimapViewStateV2 view)
        {
            GameObject stage = GameObject.Find(StageName);
            GameObject panel = new GameObject("LayeredMinimapPresentationQA");
            panel.transform.SetParent(stage.transform, false);
            CreateCaptureCube("MapBackdrop", panel.transform, new Vector3(0f, 0f, 0.45f),
                new Vector3(17f, 10.5f, 0.15f), new Color(0.025f, 0.060f, 0.12f, 1f));
            CreateCaptureCube("MapFrameTop", panel.transform, new Vector3(0f, 5.1f, 0f),
                new Vector3(17f, 0.12f, 0.18f), new Color(0.18f, 0.92f, 1f, 1f));
            CreateCaptureCube("MapFrameBottom", panel.transform, new Vector3(0f, -5.1f, 0f),
                new Vector3(17f, 0.12f, 0.18f), new Color(0.18f, 0.92f, 1f, 1f));
            AddCaptureLabel(panel.transform, "LAYERED MINIMAP // DATA + PRESENTATION QA",
                new Vector3(0f, 4.55f, -0.18f), 0.075f, new Color(0.80f, 0.96f, 1f, 1f));
            AddCaptureLabel(panel.transform, "LOWER", new Vector3(-5.3f, 3.72f, -0.18f), 0.058f,
                new Color(0.35f, 0.46f, 0.62f, 1f));
            AddCaptureLabel(panel.transform, "ENTRY // SELECTED", new Vector3(0f, 3.72f, -0.18f), 0.058f,
                new Color(0.28f, 1f, 0.82f, 1f));
            AddCaptureLabel(panel.transform, "UPPER", new Vector3(5.3f, 3.72f, -0.18f), 0.058f,
                new Color(0.35f, 0.46f, 0.62f, 1f));

            DungeonLayeredMapRegionV2[] regions = view.Regions.ToArray();
            if (regions.Length == 0) return panel;
            float minX = regions.Min(value => value.Center.x);
            float maxX = regions.Max(value => value.Center.x);
            float minY = regions.Min(value => value.Center.y);
            float maxY = regions.Max(value => value.Center.y);
            float spanX = Mathf.Max(1f, maxX - minX);
            float spanY = Mathf.Max(1f, maxY - minY);
            var positions = new System.Collections.Generic.Dictionary<string, Vector3>(StringComparer.Ordinal);
            var districtKinds = plan.Districts.ToDictionary(value => value.Id, value => value.Kind, StringComparer.Ordinal);
            var knowledge = view.RegionKnowledge.ToDictionary(value => value.RegionId, value => value.Level, StringComparer.Ordinal);
            foreach (DungeonLayeredMapRegionV2 region in regions)
            {
                float x = Mathf.Lerp(-7.0f, 7.0f, (region.Center.x - minX) / spanX);
                float y = Mathf.Lerp(-3.5f, 2.8f, (region.Center.y - minY) / spanY);
                Vector3 position = new Vector3(x, y, -0.02f);
                positions[region.Id] = position;
                Color color = DistrictColor(districtKinds[region.DistrictId]);
                DungeonMapKnowledgeLevelV2 level = knowledge.TryGetValue(region.Id, out DungeonMapKnowledgeLevelV2 found)
                    ? found
                    : DungeonMapKnowledgeLevelV2.Seen;
                float brightness = level == DungeonMapKnowledgeLevelV2.Explored ? 1f
                    : level == DungeonMapKnowledgeLevelV2.Visited ? 0.80f : 0.56f;
                color = new Color(color.r * brightness, color.g * brightness, color.b * brightness, 1f);
                float width = Mathf.Clamp(region.Size.x / spanX * 12f, 0.85f, 2.7f);
                float height = Mathf.Clamp(region.Size.y / spanY * 5f, 0.55f, 1.45f);
                GameObject tile = CreateCaptureCube("MapRegion_" + region.Id, panel.transform,
                    position, new Vector3(width, height, 0.20f), color);
                AddCaptureLabel(tile.transform, ShortRegionId(region.Id) + "\n" + level.ToString().ToUpperInvariant(),
                    new Vector3(0f, 0f, -0.18f), 0.028f, Color.white);
            }

            foreach (DungeonLayeredMapConnectionV2 connection in view.Connections)
            {
                if (positions.TryGetValue(connection.FromRegionId, out Vector3 from)
                    && positions.TryGetValue(connection.ToRegionId, out Vector3 to))
                {
                    CreateCaptureLine("MapConnection_" + connection.Id, panel.transform,
                        from + Vector3.forward * 0.10f, to + Vector3.forward * 0.10f,
                        connection.IsProtected ? new Color(1f, 0.34f, 0.25f, 1f)
                            : new Color(0.24f, 0.88f, 1f, 1f),
                        connection.IsProtected ? 0.10f : 0.055f);
                }
            }

            AddCaptureLabel(panel.transform,
                "CYAN: ROUTE   RED: PROTECTED GATE   DIM: SEEN   BRIGHT: VISITED / EXPLORED",
                new Vector3(0f, -4.60f, -0.18f), 0.035f, new Color(0.72f, 0.88f, 1f, 1f));
            return panel;
        }

        private static void SetGeneratedRenderersEnabled(DungeonSceneBuilderV2 builder, bool enabled)
        {
            foreach (Renderer renderer in builder.GeneratedRoot.GetComponentsInChildren<Renderer>(true))
            {
                renderer.enabled = enabled;
            }
        }

        private static void AddStratumLegend(Transform parent, Bounds bounds)
        {
            float x = bounds.min.x - 2.5f;
            AddCaptureLabel(parent, "UPPER // +3m", parent.InverseTransformPoint(new Vector3(x, 3.7f, bounds.min.z)),
                0.055f, new Color(0.88f, 0.78f, 1f, 1f));
            AddCaptureLabel(parent, "ENTRY // 0m", parent.InverseTransformPoint(new Vector3(x, 0.7f, bounds.min.z)),
                0.055f, new Color(0.72f, 0.94f, 1f, 1f));
            AddCaptureLabel(parent, "LOWER // -6m", parent.InverseTransformPoint(new Vector3(x, -5.3f, bounds.min.z)),
                0.055f, new Color(0.24f, 1f, 0.82f, 1f));
        }

        private static Vector3 RegionCenter(DungeonRegionPlanV2 region)
        {
            return DungeonUnityCoordinates.ToUnity(
                (region.Bounds.Minimum.X + region.Bounds.Maximum.X) * 0.5d,
                region.Bounds.Minimum.Y,
                (region.Bounds.Minimum.Z + region.Bounds.Maximum.Z) * 0.5d);
        }

        private static GameObject CreateCaptureCube(
            string name,
            Transform parent,
            Vector3 localPosition,
            Vector3 localScale,
            Color color)
        {
            GameObject target = GameObject.CreatePrimitive(PrimitiveType.Cube);
            target.name = name;
            target.transform.SetParent(parent, false);
            target.transform.localPosition = localPosition;
            target.transform.localScale = localScale;
            Collider collider = target.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = target.GetComponent<Renderer>();
            renderer.sharedMaterial = AssetDatabase.GetBuiltinExtraResource<Material>("Default-Material.mat");
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", color);
            block.SetColor("_Color", color);
            renderer.SetPropertyBlock(block);
            return target;
        }

        private static GameObject CreateCaptureLine(
            string name,
            Transform parent,
            Vector3 start,
            Vector3 end,
            Color color,
            float thickness)
        {
            Vector3 delta = end - start;
            GameObject line = CreateCaptureCube(name, parent, (start + end) * 0.5f,
                new Vector3(thickness, thickness, Mathf.Max(0.05f, delta.magnitude)), color);
            if (delta.sqrMagnitude > 0.0001f)
            {
                line.transform.localRotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
            }
            return line;
        }

        private static void AddCaptureLabel(
            Transform parent,
            string value,
            Vector3 localPosition,
            float characterSize,
            Color color)
        {
            GameObject labelObject = new GameObject("Label_" + value.Replace(' ', '_'));
            labelObject.transform.SetParent(parent, false);
            labelObject.transform.localPosition = localPosition;
            TextMesh label = labelObject.AddComponent<TextMesh>();
            label.text = value;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 64;
            label.characterSize = characterSize;
            label.color = color;
        }

        private static string ShortRegionId(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "REGION";
            string[] parts = value.Split('-');
            return string.Join("-", parts.Skip(Mathf.Max(0, parts.Length - 3))).ToUpperInvariant();
        }

        private static Color DistrictColor(DungeonBiomeDistrictKindV2 kind)
        {
            switch (kind)
            {
                case DungeonBiomeDistrictKindV2.Waterworks:
                    return new Color(0.10f, 0.66f, 0.94f, 1f);
                case DungeonBiomeDistrictKindV2.MagmaUndercroft:
                    return new Color(1f, 0.34f, 0.12f, 1f);
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft:
                    return new Color(0.72f, 0.34f, 1f, 1f);
                default:
                    return new Color(0.28f, 0.60f, 0.72f, 1f);
            }
        }

        private static void CreatePlayerScaleReference(Bounds bounds)
        {
            GameObject stage = GameObject.Find(StageName);
            GameObject body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.name = "PlayerScaleReference_2_85m";
            body.transform.SetParent(stage.transform, true);
            body.transform.position = new Vector3(
                bounds.max.x + 1.15f,
                bounds.max.y + 1.425f,
                bounds.center.z - bounds.extents.z * 0.35f);
            body.transform.localScale = new Vector3(0.84f, 1.425f, 0.84f);
            Collider bodyCollider = body.GetComponent<Collider>();
            if (bodyCollider != null) UnityEngine.Object.DestroyImmediate(bodyCollider);
            Renderer bodyRenderer = body.GetComponent<Renderer>();
            bodyRenderer.sharedMaterial = AssetDatabase.GetBuiltinExtraResource<Material>("Default-Material.mat");
            var bodyBlock = new MaterialPropertyBlock();
            bodyBlock.SetColor("_BaseColor", new Color(0.05f, 0.26f, 0.78f, 1f));
            bodyBlock.SetColor("_Color", new Color(0.05f, 0.26f, 0.78f, 1f));
            bodyRenderer.SetPropertyBlock(bodyBlock);

            GameObject buster = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            buster.name = "PlayerScaleBuster";
            buster.transform.SetParent(body.transform, false);
            buster.transform.localPosition = new Vector3(0.72f, 0.30f, 0f);
            buster.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            buster.transform.localScale = new Vector3(0.16f, 0.72f, 0.16f);
            Collider busterCollider = buster.GetComponent<Collider>();
            if (busterCollider != null) UnityEngine.Object.DestroyImmediate(busterCollider);
            Renderer busterRenderer = buster.GetComponent<Renderer>();
            busterRenderer.sharedMaterial = bodyRenderer.sharedMaterial;
            var busterBlock = new MaterialPropertyBlock();
            busterBlock.SetColor("_BaseColor", new Color(0.15f, 0.85f, 0.96f, 1f));
            busterBlock.SetColor("_Color", new Color(0.15f, 0.85f, 0.96f, 1f));
            busterRenderer.SetPropertyBlock(busterBlock);

            GameObject labelObject = new GameObject("PlayerScaleLabel");
            labelObject.transform.SetParent(stage.transform, true);
            labelObject.transform.position = body.transform.position + Vector3.up * 1.85f;
            TextMesh label = labelObject.AddComponent<TextMesh>();
            label.text = "PLAYER SCALE // 2.85m";
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 48;
            label.characterSize = 0.04f;
            label.color = new Color(0.72f, 0.90f, 1f, 1f);
        }

        private static void OrientLabels()
        {
            Camera camera = GameObject.Find(CameraName)?.GetComponent<Camera>();
            GameObject stage = GameObject.Find(StageName);
            if (camera == null || stage == null) return;
            foreach (TextMesh text in stage.GetComponentsInChildren<TextMesh>(true))
            {
                Vector3 direction = text.transform.position - camera.transform.position;
                if (direction.sqrMagnitude > 0.001f)
                {
                    text.transform.rotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
                }
            }
        }

        private static void SetCaptureTitle(string value)
        {
            GameObject stage = GameObject.Find(StageName);
            TextMesh title = stage != null
                ? stage.GetComponentsInChildren<TextMesh>(true)
                    .FirstOrDefault(text => text.gameObject.name == "CaptureTitle")
                : null;
            if (title != null)
            {
                title.text = value;
            }
        }

        private static DungeonHazardDistrictRuntimeV2 RequireElectricDistrict()
        {
            GameObject stage = GameObject.Find(StageName);
            DungeonHazardDistrictRuntimeV2 district = stage != null
                ? stage.GetComponentsInChildren<DungeonHazardDistrictRuntimeV2>(true)
                    .FirstOrDefault(value => value.Kind == DungeonHazardSurfaceKindV2.Electric)
                : null;
            return district ?? throw new InvalidOperationException("Build the Electric Safe capture stage first.");
        }

        private static DungeonPlanV2 FindPlan(DungeonBiomeDistrictKindV2 kind)
        {
            var generator = new IndustrialFactoryV2Generator();
            for (int index = 0; index < 128; index += 1)
            {
                DungeonPlanV2 plan = generator.Generate("industrial-factory-v2-capture-" + kind + "-" + index);
                if (plan.Districts.Any(district => district.Kind == kind))
                {
                    return plan;
                }
            }

            throw new InvalidOperationException("Unable to find a deterministic capture fixture for " + kind + ".");
        }
    }
}
