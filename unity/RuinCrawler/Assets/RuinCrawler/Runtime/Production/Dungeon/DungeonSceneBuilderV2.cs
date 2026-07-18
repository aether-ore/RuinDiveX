using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.Rendering;

namespace RuinCrawler.Runtime.Dungeon
{
    public enum DungeonHazardSurfaceKindV2
    {
        Magma,
        Electric
    }

    [DisallowMultipleComponent]
    public sealed class DungeonHazardSurfaceRuntimeV2 : MonoBehaviour
    {
        public string StableId { get; private set; }
        public string RegionId { get; private set; }
        public DungeonHazardSurfaceKindV2 Kind { get; private set; }

        internal void Configure(string stableId, string regionId, DungeonHazardSurfaceKindV2 kind)
        {
            StableId = stableId;
            RegionId = regionId;
            Kind = kind;
        }
    }

    /// <summary>
    /// Graybox V2 assembler. It consumes only an accepted immutable plan,
    /// extrudes certified convex prisms, and owns every mesh/material it creates
    /// so repeated Camp/Expedition transitions have a deterministic teardown.
    /// This is the sole production dungeon assembler.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonSceneBuilderV2 : MonoBehaviour
    {
        private const string CertifiedRegistryResourcePath =
            "DungeonV2/DungeonCertifiedGeometryRegistryV2";

        [SerializeField] private Transform generatedParent;
        [SerializeField] private bool addFallbackRecovery = true;
        [SerializeField] private DungeonCertifiedGeometryRegistryV2 certifiedGeometryRegistry;
        [SerializeField] private bool requireCertifiedModuleRegistry = true;
        [SerializeField] private bool allowCertifiedRegistryResourceFallback = true;
        [SerializeField] private bool createLocalNavigation = true;
        [SerializeField] private bool bakeLocalNavigationOnBuild;
        [SerializeField] private int worldGeometryLayer = -1;

        private readonly List<Mesh> ownedMeshes = new List<Mesh>();
        private readonly Dictionary<string, Material> ownedMaterials =
            new Dictionary<string, Material>(StringComparer.Ordinal);

        public DungeonPlanV2 CurrentPlan => CurrentInstance?.Plan;
        public DungeonSceneInstanceV2 CurrentInstance { get; private set; }
        public GameObject GeneratedRoot => CurrentInstance?.Root;
        public string LastError { get; private set; }
        public int CertifiedModuleCount { get; private set; }

        public void ConfigureCertifiedGeometryRegistry(
            DungeonCertifiedGeometryRegistryV2 registry,
            bool requireRegistry = true,
            bool allowResourceFallback = true)
        {
            certifiedGeometryRegistry = registry;
            requireCertifiedModuleRegistry = requireRegistry;
            allowCertifiedRegistryResourceFallback = allowResourceFallback;
        }

        public void ConfigureLocalNavigation(
            bool createNavigation,
            bool bakeImmediately,
            int geometryLayer = -1)
        {
            createLocalNavigation = createNavigation;
            bakeLocalNavigationOnBuild = bakeImmediately;
            worldGeometryLayer = geometryLayer;
        }

        public bool TryBuild(
            DungeonPlanV2 plan,
            DungeonEnvironmentSnapshotV2 restoredEnvironment,
            DungeonMapKnowledgeStateV2 restoredKnowledge,
            out string error,
            IEnumerable<string> restoredRequiredItems = null,
            IEnumerable<string> restoredDiscoveries = null,
            IEnumerable<string> restoredProgressionFacts = null)
        {
            TearDown();
            if (plan == null)
            {
                return Fail("A validated DungeonPlanV2 is required.", out error);
            }

            IndustrialFactoryV2ValidationResult validation =
                new IndustrialFactoryV2Validator().Validate(plan);
            if (!validation.Accepted)
            {
                return Fail(
                    "V2 scene assembly rejected an invalid plan: "
                        + string.Join(" | ", validation.Errors.Select(value => value.ToString())),
                    out error);
            }

            if (!TryValidateCertifiedModules(plan, out string certificationError))
            {
                return Fail(certificationError, out error);
            }

            try
            {
                var root = new GameObject("GeneratedDungeonV2_" + Sanitize(plan.Seed));
                root.transform.SetParent(generatedParent != null ? generatedParent : transform, false);
                DungeonEnvironmentRuntimeV2 environment = root.AddComponent<DungeonEnvironmentRuntimeV2>();
                environment.Configure(
                    plan,
                    restoredEnvironment,
                    restoredRequiredItems,
                    restoredDiscoveries,
                    restoredProgressionFacts,
                    new[] { TraversalProfilesV2.DryId, TraversalProfilesV2.FloodedId });
                DungeonLayeredMinimapComponentV2 minimap = root.AddComponent<DungeonLayeredMinimapComponentV2>();
                minimap.Configure(plan, restoredKnowledge);

                DungeonAnchorPlanV2 entrance = plan.Anchors.FirstOrDefault(value =>
                    value.RegionId == plan.EntranceRegionId
                    && (value.Kind == DungeonAnchorKindV2.Spawn || value.Kind == DungeonAnchorKindV2.Entry));
                Vector3 entrancePosition = entrance != null
                    ? DungeonUnityCoordinates.ToUnity(entrance.Position)
                    : DungeonUnityCoordinates.ToUnity(plan.Bounds.Minimum.X, plan.Bounds.Minimum.Y + 1d, plan.Bounds.Minimum.Z);
                DungeonFallbackRecoveryV2 fallback = addFallbackRecovery
                    ? BuildFallback(root.transform, plan, entrancePosition)
                    : null;

                var instance = new DungeonSceneInstanceV2(root, plan, environment, minimap, fallback);
                // Register ownership before assembly so any later exception can
                // deterministically tear down the partially built scene.
                CurrentInstance = instance;
                BuildRegions(instance);
                BuildSurfaces(instance);
                BuildAnchors(instance);
                BuildTraversalMechanisms(instance);
                BuildFluids(instance);
                BuildKeySeeker(instance, entrancePosition);
                BuildLocalNavigation(instance);
                LastError = null;
                error = null;
                return true;
            }
            catch (Exception exception)
            {
                TearDown();
                return Fail("V2 scene assembly failed: " + exception.Message, out error);
            }
        }

        public void TearDown()
        {
            CurrentInstance?.ReleaseNavigationData();
            if (CurrentInstance?.Root != null)
            {
                // Destroy is deferred until the end of the frame in Play Mode.
                // Deactivate immediately so stale triggers, interactions, and
                // renderers cannot survive one frame into the next expedition.
                CurrentInstance.Root.SetActive(false);
                DestroyOwned(CurrentInstance.Root);
            }

            CurrentInstance = null;
            CertifiedModuleCount = 0;
            foreach (Mesh mesh in ownedMeshes)
            {
                if (mesh != null) DestroyOwned(mesh);
            }

            ownedMeshes.Clear();
            foreach (Material material in ownedMaterials.Values)
            {
                if (material != null) DestroyOwned(material);
            }

            ownedMaterials.Clear();
        }

        private void OnDestroy()
        {
            TearDown();
        }

        private bool TryValidateCertifiedModules(DungeonPlanV2 plan, out string error)
        {
            DungeonCertifiedGeometryRegistryV2 registry = certifiedGeometryRegistry;
            if (registry == null && allowCertifiedRegistryResourceFallback)
            {
                registry = Resources.Load<DungeonCertifiedGeometryRegistryV2>(CertifiedRegistryResourcePath);
            }

            if (registry == null)
            {
                CertifiedModuleCount = 0;
                if (requireCertifiedModuleRegistry)
                {
                    error = "V2 scene assembly rejected the plan because the certified module registry is missing. "
                        + "Generate the Dungeon V2 certified module content pack or assign a registry explicitly.";
                    return false;
                }

                foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
                {
                    IndustrialFactoryV2ModuleDefinition definition;
                    try
                    {
                        definition = IndustrialFactoryV2ModuleCatalog.Require(module.TemplateId);
                    }
                    catch (Exception exception)
                    {
                        error = "V2 module certification failed for '" + module.Id + "': " + exception.Message;
                        return false;
                    }

                    if (!string.Equals(module.ContentHash, definition.ContentHash, StringComparison.Ordinal))
                    {
                        error = "V2 module certification failed for '" + module.Id + "': plan hash "
                            + module.ContentHash + " does not match Core catalog hash " + definition.ContentHash + ".";
                        return false;
                    }

                    IReadOnlyList<IndustrialFactoryV2ValidationIssue> placementErrors =
                        DungeonCertifiedModulePlacementValidatorV2.ValidateModule(
                            plan,
                            module,
                            definition.CertifiedGeometry);
                    if (placementErrors.Count > 0)
                    {
                        error = "V2 module certification failed for '" + module.Id
                            + "': " + string.Join(" | ", placementErrors.Select(value => value.ToString()));
                        return false;
                    }
                }

                CertifiedModuleCount = plan.Modules.Count;
                error = string.Empty;
                return true;
            }

            int resolvedCount = 0;
            foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
            {
                if (!registry.TryResolve(
                    module,
                    out _,
                    out CertifiedDungeonModuleGeometryV2 resolvedGeometry,
                    out string resolutionError))
                {
                    CertifiedModuleCount = 0;
                    error = "V2 module certification failed for '" + module.Id + "' (template '"
                        + module.TemplateId + "'): " + resolutionError;
                    return false;
                }

                IReadOnlyList<IndustrialFactoryV2ValidationIssue> placementErrors =
                    DungeonCertifiedModulePlacementValidatorV2.ValidateModule(
                        plan,
                        module,
                        resolvedGeometry);
                if (placementErrors.Count > 0)
                {
                    CertifiedModuleCount = 0;
                    error = "V2 module certification failed for '" + module.Id
                        + "' (template '" + module.TemplateId + "'): "
                        + string.Join(" | ", placementErrors.Select(value => value.ToString()));
                    return false;
                }

                resolvedCount += 1;
            }

            CertifiedModuleCount = resolvedCount;
            error = string.Empty;
            return true;
        }

        private void BuildRegions(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("Regions");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonRegionPlanV2 region in instance.Plan.Regions)
            {
                GameObject target = new GameObject("Region_" + region.Id);
                target.transform.SetParent(container.transform, false);
                ConfigureBoxFromBounds(target, region.Bounds, isTrigger: true);
                target.AddComponent<DungeonRegionRuntimeV2>().Configure(region, instance.Minimap);
                instance.RegionCount += 1;
            }
        }

        private void BuildLocalNavigation(DungeonSceneInstanceV2 instance)
        {
            if (!createLocalNavigation)
            {
                return;
            }

            var container = new GameObject("LocalNavigation");
            container.transform.SetParent(instance.Root.transform, false);
            int navigationLayer = ResolveWorldGeometryLayer();
            foreach (IGrouping<string, DungeonRegionPlanV2> group in instance.Plan.Regions
                         .GroupBy(value => value.LocalNavigationRegionId, StringComparer.Ordinal)
                         .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                DungeonRegionPlanV2[] regions = group.OrderBy(value => value.Id, StringComparer.Ordinal).ToArray();
                double minimumX = regions.Min(value => value.Bounds.Minimum.X);
                double minimumY = regions.Min(value => value.Bounds.Minimum.Y);
                double minimumZ = regions.Min(value => value.Bounds.Minimum.Z);
                double maximumX = regions.Max(value => value.Bounds.Maximum.X);
                double maximumY = regions.Max(value => value.Bounds.Maximum.Y);
                double maximumZ = regions.Max(value => value.Bounds.Maximum.Z);
                double centerX = (minimumX + maximumX) * 0.5d;
                double centerY = (minimumY + maximumY) * 0.5d;
                double centerZ = (minimumZ + maximumZ) * 0.5d;
                Vector3 center = DungeonUnityCoordinates.ToUnity(centerX, centerY, centerZ);
                var size = new Vector3(
                    (float)(maximumX - minimumX),
                    (float)(maximumY - minimumY),
                    (float)(maximumZ - minimumZ));

                GameObject target = new GameObject(
                    "LocalNavigation_" + Sanitize(group.Key));
                target.transform.SetParent(container.transform, false);
                var navigation = target.AddComponent<DungeonLocalNavigationRuntimeV2>();
                // Register ownership before configuration/baking so an
                // exception cannot strand partially-created NavMeshData.
                instance.AddLocalNavigation(navigation);
                navigation.Configure(
                    group.Key,
                    regions.Select(value => value.Id),
                    center,
                    size,
                    navigationLayer,
                    bakeLocalNavigationOnBuild,
                    instance.Environment);
            }
        }

        private void BuildSurfaces(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("CertifiedSurfaces");
            container.transform.SetParent(instance.Root.transform, false);
            var hazardContainer = new GameObject("HazardDistricts");
            hazardContainer.transform.SetParent(instance.Root.transform, false);
            var hazardDistricts = new Dictionary<string, DungeonHazardDistrictRuntimeV2>(StringComparer.Ordinal);
            foreach (DungeonSurfacePlanV2 surface in instance.Plan.Surfaces)
            {
                DungeonBiomeDistrictKindV2 districtKind = ResolveDistrictKind(surface.RegionId, instance.Plan);
                GameObject target = CreatePrismObject(
                    "Surface_" + surface.Id,
                    surface.Volume,
                    container.transform,
                    ResolveMaterial(surface, instance.Plan));
                if (surface.IsStructural || surface.IsWalkable)
                {
                    int geometryLayer = ResolveWorldGeometryLayer();
                    if (geometryLayer >= 0)
                    {
                        target.layer = geometryLayer;
                    }
                    var collider = target.AddComponent<MeshCollider>();
                    collider.sharedMesh = target.GetComponent<MeshFilter>().sharedMesh;
                }

                ConfigureAuthoredSurfaceMechanism(target, surface, instance.Environment);

                instance.Environment.RegisterPredicateTarget(target, surface.ActivePredicate);
                instance.SurfaceCount += 1;
                if (surface.Kind != DungeonSurfaceKindV2.Hazard)
                {
                    if (surface.IsWalkable
                        || surface.Kind == DungeonSurfaceKindV2.WaterBed
                        || surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
                    {
                        target.AddComponent<DungeonSurfacePresentationV2>().Configure(
                            target.GetComponent<Renderer>(),
                            districtKind,
                            surface.Kind,
                            ResolveDistrictAccentMaterial(districtKind));
                    }

                    continue;
                }

                DungeonHazardSurfaceKindV2 hazardKind = ResolveHazardKind(surface.RegionId, instance.Plan);
                string controllerId = !string.IsNullOrWhiteSpace(surface.ControllerId)
                    ? surface.ControllerId
                    : "hazard-" + hazardKind.ToString().ToLowerInvariant() + "-" + surface.RegionId;
                string districtKey = hazardKind + "|" + controllerId;
                if (!hazardDistricts.TryGetValue(districtKey, out DungeonHazardDistrictRuntimeV2 hazardDistrict))
                {
                    var districtObject = new GameObject("HazardDistrict_" + Sanitize(controllerId));
                    districtObject.transform.SetParent(hazardContainer.transform, false);
                    districtObject.transform.position = target.GetComponent<Renderer>().bounds.center;
                    hazardDistrict = districtObject.AddComponent<DungeonHazardDistrictRuntimeV2>();
                    hazardDistrict.Configure(
                        hazardKind,
                        controllerId,
                        instance.Environment,
                        simulateAutomatically: true);
                    districtObject.AddComponent<AudioSource>();
                    districtObject.AddComponent<DungeonHazardAudioPresentationV2>()
                        .Configure(hazardDistrict);
                    hazardDistricts.Add(districtKey, hazardDistrict);
                }

                target.AddComponent<DungeonHazardSurfaceRuntimeV2>()
                    .Configure(surface.Id, surface.RegionId, hazardKind);
                target.AddComponent<DungeonHazardSurfaceVisualV2>()
                    .Configure(target.GetComponent<Renderer>(), hazardDistrict);
                target.AddComponent<DungeonHazardSurfaceCueV2>().Configure(
                    target.GetComponent<Renderer>(),
                    hazardDistrict,
                    GetOrCreateMaterial(
                        hazardKind == DungeonHazardSurfaceKindV2.Magma
                            ? "hazard-cue-magma"
                            : "hazard-cue-electric",
                        hazardKind == DungeonHazardSurfaceKindV2.Magma
                            ? new Color(1f, 0.32f, 0.025f, 1f)
                            : new Color(0.30f, 0.90f, 1f, 1f),
                        false,
                        true),
                    GetOrCreateMaterial("hazard-cue-dark", new Color(0.035f, 0.045f, 0.055f, 1f), false, false));
                GameObject trigger = new GameObject("HazardTrigger_" + surface.Id);
                trigger.transform.SetParent(target.transform, false);
                ConfigureBoxFromPrism(trigger, surface.Volume, target.transform);
                trigger.AddComponent<DungeonHazardTileRelayV2>()
                    .Configure(surface.Id, hazardDistrict);
                instance.HazardSurfaceCount += 1;
            }
        }

        private static void ConfigureAuthoredSurfaceMechanism(
            GameObject target,
            DungeonSurfacePlanV2 surface,
            DungeonEnvironmentRuntimeV2 environment)
        {
            if (surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
            {
                var body = target.AddComponent<Rigidbody>();
                body.isKinematic = true;
                body.useGravity = false;
                body.interpolation = RigidbodyInterpolation.Interpolate;

                var platform = target.AddComponent<DungeonMovingPlatformRuntimeV2>();
                platform.Configure(body, Vector3.forward, distance: 2.5f, periodSeconds: 4f);

                GameObject riderTrigger = new GameObject("RiderTrigger_" + surface.Id);
                riderTrigger.transform.SetParent(target.transform, false);
                BoxCollider trigger = ConfigureBoxFromPrism(
                    riderTrigger,
                    surface.Volume,
                    target.transform);
                trigger.size = new Vector3(trigger.size.x, trigger.size.y + 0.8f, trigger.size.z);
                trigger.center += Vector3.up * 0.4f;
                riderTrigger.AddComponent<DungeonMovingPlatformRiderRelayV2>().Configure(platform);
            }

            if (!string.Equals(
                    surface.Id,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleSurfaceId,
                    StringComparison.Ordinal))
            {
                return;
            }

            var crumble = target.AddComponent<DungeonCrumbleSurfaceRuntimeV2>();
            crumble.Configure(
                environment,
                IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                "collapse-credential-tower-platform");
            GameObject crumbleTrigger = new GameObject("CrumbleTrigger_" + surface.Id);
            crumbleTrigger.transform.SetParent(target.transform, false);
            BoxCollider crumbleCollider = ConfigureBoxFromPrism(
                crumbleTrigger,
                surface.Volume,
                target.transform);
            crumbleCollider.size = new Vector3(
                crumbleCollider.size.x,
                crumbleCollider.size.y + 0.65f,
                crumbleCollider.size.z);
            crumbleCollider.center += Vector3.up * 0.325f;
            crumbleTrigger.AddComponent<DungeonCrumbleSurfaceRelayV2>().Configure(crumble);
        }

        private void BuildAnchors(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("Anchors");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonAnchorPlanV2 anchor in instance.Plan.Anchors)
            {
                GameObject target = new GameObject("Anchor_" + anchor.Id);
                target.transform.SetParent(container.transform, false);
                target.transform.position = DungeonUnityCoordinates.ToUnity(anchor.Position);
                target.AddComponent<DungeonAnchorRuntimeV2>().Configure(anchor);
                if (anchor.Kind == DungeonAnchorKindV2.Safe && instance.Fallback != null)
                {
                    var trigger = target.AddComponent<SphereCollider>();
                    trigger.isTrigger = true;
                    trigger.radius = 1f;
                    target.AddComponent<DungeonSafeAnchorRuntimeV2>().Configure(instance.Fallback);
                    target.AddComponent<DungeonSafePadPresentationV2>().Configure(
                        anchor.Id,
                        GetOrCreateMaterial("safe-pad", new Color(0.08f, 0.46f, 0.32f, 1f), false, true),
                        GetOrCreateMaterial("safe-pad-symbol", new Color(0.76f, 1f, 0.84f, 1f), false, true));
                }

                if (anchor.Kind == DungeonAnchorKindV2.Landmark)
                {
                    DungeonBiomeDistrictKindV2 districtKind = ResolveDistrictKind(anchor.RegionId, instance.Plan);
                    target.AddComponent<DungeonDistrictLandmarkPresentationV2>().Configure(
                        anchor.Id,
                        districtKind,
                        ResolveDistrictPrimaryMaterial(districtKind),
                        ResolveDistrictAccentMaterial(districtKind),
                        GetOrCreateMaterial("landmark-dark", new Color(0.045f, 0.075f, 0.09f, 1f), false, false));
                }

                if (anchor.Kind == DungeonAnchorKindV2.Console
                    && !string.IsNullOrWhiteSpace(anchor.ProfileId)
                    && instance.Plan.EnvironmentControllers.Any(value => value.Id == anchor.ProfileId))
                {
                    GameObject console = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    console.name = "ConsolePresentation_" + anchor.Id;
                    console.transform.SetParent(target.transform, false);
                    console.transform.localPosition = Vector3.up * 0.75f;
                    console.transform.localScale = new Vector3(0.85f, 1.5f, 0.55f);
                    console.GetComponent<Renderer>().sharedMaterial = GetOrCreateMaterial(
                        "factory-console",
                        new Color(0.08f, 0.72f, 0.62f, 1f),
                        false,
                        true);
                    target.AddComponent<DungeonEnvironmentConsoleRuntimeV2>().Configure(
                        anchor.ProfileId,
                        instance.Environment,
                        instance.Minimap,
                        CreatePrompt(target.transform, "F / X  OPERATE CONSOLE"));
                }

                if (anchor.Kind == DungeonAnchorKindV2.ShortcutActivation
                    && !string.IsNullOrWhiteSpace(anchor.ProfileId))
                {
                    target.AddComponent<DungeonShortcutInteractionRuntimeV2>().Configure(
                        anchor.ProfileId,
                        instance.Environment,
                        instance.Minimap,
                        CreatePrompt(target.transform, "F / X  ACTIVATE SHORTCUT"));
                }

                instance.AnchorCount += 1;
            }
        }

        private void BuildKeySeeker(DungeonSceneInstanceV2 instance, Vector3 entrancePosition)
        {
            GameObject target = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            target.name = "KeySeekerV2";
            target.transform.SetParent(instance.Root.transform, false);
            target.transform.position = entrancePosition + Vector3.right * 2.25f + Vector3.up * 0.6f;
            target.transform.localScale = new Vector3(0.55f, 0.6f, 0.55f);
            target.GetComponent<Renderer>().sharedMaterial = GetOrCreateMaterial(
                "key-seeker",
                new Color(0.22f, 0.92f, 0.78f, 1f),
                false,
                true);
            target.AddComponent<DungeonKeySeekerRuntimeV2>().Configure(
                instance.Plan,
                instance.Environment,
                instance.Minimap,
                CreatePrompt(target.transform, "F / X  KEY SEEKER"));
        }

        private void BuildTraversalMechanisms(DungeonSceneInstanceV2 instance)
        {
            Dictionary<string, DungeonAnchorRuntimeV2> anchors = instance.Root
                .GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                .ToDictionary(value => value.StableId, StringComparer.Ordinal);
            foreach (DungeonTraversalEdgePlanV2 edge in instance.Plan.TraversalEdges
                .Where(value => value.Kind == DungeonConnectorKindV2.Lift
                    && value.AccessPredicate.Clauses.Count > 0)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (!anchors.TryGetValue(edge.FromAnchorId, out DungeonAnchorRuntimeV2 source)
                    || !anchors.TryGetValue(edge.ToAnchorId, out DungeonAnchorRuntimeV2 destination)
                    || source.GetComponent<DungeonLiftInteractionRuntimeV2>() != null)
                {
                    continue;
                }

                GameObject platform = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                platform.name = "LiftPresentation_" + edge.Id;
                platform.transform.SetParent(source.transform, false);
                platform.transform.localPosition = Vector3.down * 0.15f;
                platform.transform.localScale = new Vector3(1.45f, 0.15f, 1.45f);
                platform.GetComponent<Renderer>().sharedMaterial = GetOrCreateMaterial(
                    "factory-lift",
                    new Color(0.24f, 0.72f, 0.68f, 1f),
                    false,
                    true);
                source.gameObject.AddComponent<DungeonLiftInteractionRuntimeV2>().Configure(
                    edge,
                    destination.transform,
                    instance.Environment,
                    instance.Minimap,
                    CreatePrompt(source.transform, "F / X  OPERATE LIFT"));
            }
        }

        private static TextMesh CreatePrompt(Transform parent, string text)
        {
            var promptObject = new GameObject("InteractionPrompt");
            promptObject.transform.SetParent(parent, false);
            promptObject.transform.localPosition = Vector3.up * 2f;
            var prompt = promptObject.AddComponent<TextMesh>();
            prompt.text = text;
            prompt.fontSize = 48;
            prompt.characterSize = 0.045f;
            prompt.anchor = TextAnchor.MiddleCenter;
            prompt.alignment = TextAlignment.Center;
            prompt.color = new Color(0.72f, 1f, 0.96f, 1f);
            promptObject.SetActive(false);
            return prompt;
        }

        private void BuildFluids(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("FluidZones");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonFluidZonePlanV2 fluid in instance.Plan.FluidZones)
            {
                GameObject target = CreatePrismObject(
                    "Fluid_" + fluid.Id,
                    fluid.Volume,
                    container.transform,
                    GetOrCreateMaterial("fluid-water", new Color(0.025f, 0.30f, 0.48f, 0.46f), true, false));
                target.AddComponent<DungeonFluidSurfacePresentationV2>().Configure(
                    fluid.Id,
                    target.GetComponent<Renderer>(),
                    GetOrCreateMaterial("fluid-wave", new Color(0.22f, 0.94f, 1f, 0.88f), true, true));
                target.AddComponent<AudioSource>();
                target.AddComponent<DungeonFluidAudioPresentationV2>().Configure(fluid.Id);
                GameObject trigger = new GameObject("FluidTrigger_" + fluid.Id);
                trigger.transform.SetParent(target.transform, false);
                ConfigureBoxFromPrism(trigger, fluid.Volume, target.transform);
                trigger.AddComponent<PlayerTraversalMediumVolume>().Configure(
                    PlayerTraversalMediumKind.FloodedBottomWalk,
                    (float)(fluid.Volume.MaximumY - fluid.Volume.MinimumY),
                    volumePriority: 10,
                    volumeId: fluid.Id);
                trigger.AddComponent<DungeonFluidZoneRuntimeV2>().Configure(fluid);
                instance.Environment.RegisterFluidTarget(target, fluid.FluidNetworkId, fluid.Id);
                instance.FluidZoneCount += 1;
            }
        }

        private DungeonFallbackRecoveryV2 BuildFallback(
            Transform parent,
            DungeonPlanV2 plan,
            Vector3 entrancePosition)
        {
            GameObject target = new GameObject("TechnicalFallbackPlane_V2_TEST_FAILURE");
            target.transform.SetParent(parent, false);
            double centerX = (plan.Bounds.Minimum.X + plan.Bounds.Maximum.X) * 0.5d;
            double centerZ = (plan.Bounds.Minimum.Z + plan.Bounds.Maximum.Z) * 0.5d;
            double width = plan.Bounds.Maximum.X - plan.Bounds.Minimum.X + 32d;
            double depth = plan.Bounds.Maximum.Z - plan.Bounds.Minimum.Z + 32d;
            target.transform.position = DungeonUnityCoordinates.ToUnity(
                centerX,
                plan.Bounds.Minimum.Y - 8d,
                centerZ);
            var collider = target.AddComponent<BoxCollider>();
            collider.isTrigger = true;
            collider.size = new Vector3((float)width, 1f, (float)depth);
            DungeonFallbackRecoveryV2 fallback = target.AddComponent<DungeonFallbackRecoveryV2>();
            fallback.Configure(entrancePosition, Quaternion.identity);
            return fallback;
        }

        private GameObject CreatePrismObject(
            string name,
            DungeonConvexPrismV2 prism,
            Transform parent,
            Material material)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            Mesh mesh = BuildPrismMesh(prism, name + "_Mesh");
            ownedMeshes.Add(mesh);
            target.AddComponent<MeshFilter>().sharedMesh = mesh;
            target.AddComponent<MeshRenderer>().sharedMaterial = material;
            return target;
        }

        private static Mesh BuildPrismMesh(DungeonConvexPrismV2 prism, string name)
        {
            int count = prism.HorizontalVertices.Count;
            var vertices = new Vector3[count * 2];
            for (int index = 0; index < count; index += 1)
            {
                DungeonPoint2V2 point = prism.HorizontalVertices[index];
                vertices[index] = DungeonUnityCoordinates.ToUnity(point.X, prism.MinimumY, point.Z);
                vertices[index + count] = DungeonUnityCoordinates.ToUnity(point.X, prism.MaximumY, point.Z);
            }

            var triangles = new List<int>((count - 2) * 6 + count * 6);
            for (int index = 1; index < count - 1; index += 1)
            {
                triangles.Add(0);
                triangles.Add(index + 1);
                triangles.Add(index);
                triangles.Add(count);
                triangles.Add(count + index);
                triangles.Add(count + index + 1);
            }

            for (int index = 0; index < count; index += 1)
            {
                int next = (index + 1) % count;
                triangles.Add(index);
                triangles.Add(next);
                triangles.Add(count + index);
                triangles.Add(next);
                triangles.Add(count + next);
                triangles.Add(count + index);
            }

            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private void ConfigureBoxFromBounds(GameObject target, DungeonBounds3 bounds, bool isTrigger)
        {
            double centerX = (bounds.Minimum.X + bounds.Maximum.X) * 0.5d;
            double centerY = (bounds.Minimum.Y + bounds.Maximum.Y) * 0.5d;
            double centerZ = (bounds.Minimum.Z + bounds.Maximum.Z) * 0.5d;
            target.transform.position = DungeonUnityCoordinates.ToUnity(centerX, centerY, centerZ);
            var collider = target.AddComponent<BoxCollider>();
            collider.isTrigger = isTrigger;
            collider.size = new Vector3(
                (float)(bounds.Maximum.X - bounds.Minimum.X),
                (float)(bounds.Maximum.Y - bounds.Minimum.Y),
                (float)(bounds.Maximum.Z - bounds.Minimum.Z));
        }

        private static BoxCollider ConfigureBoxFromPrism(
            GameObject target,
            DungeonConvexPrismV2 prism,
            Transform coordinateParent)
        {
            double minimumX = prism.HorizontalVertices.Min(value => value.X);
            double maximumX = prism.HorizontalVertices.Max(value => value.X);
            double minimumZ = prism.HorizontalVertices.Min(value => value.Z);
            double maximumZ = prism.HorizontalVertices.Max(value => value.Z);
            Vector3 center = DungeonUnityCoordinates.ToUnity(
                (minimumX + maximumX) * 0.5d,
                (prism.MinimumY + prism.MaximumY) * 0.5d,
                (minimumZ + maximumZ) * 0.5d);
            if (coordinateParent != null)
            {
                target.transform.position = coordinateParent.TransformPoint(coordinateParent.InverseTransformPoint(center));
            }
            else
            {
                target.transform.position = center;
            }

            // Every caller creates a dedicated trigger object. Add the collider
            // explicitly: Unity's missing-component proxy can survive the C#
            // null-coalescing check in Edit Mode and then throw on first access.
            BoxCollider collider = target.AddComponent<BoxCollider>();
            collider.isTrigger = true;
            collider.center = Vector3.zero;
            collider.size = new Vector3(
                (float)(maximumX - minimumX),
                (float)(prism.MaximumY - prism.MinimumY),
                (float)(maximumZ - minimumZ));
            return collider;
        }

        private Material ResolveMaterial(DungeonSurfacePlanV2 surface, DungeonPlanV2 plan)
        {
            DungeonHazardSurfaceKindV2 hazardKind = ResolveHazardKind(surface.RegionId, plan);
            DungeonBiomeDistrictKindV2 districtKind = ResolveDistrictKind(surface.RegionId, plan);
            if (surface.Kind == DungeonSurfaceKindV2.Hazard && hazardKind == DungeonHazardSurfaceKindV2.Magma)
            {
                return GetOrCreateMaterial("hazard-magma", new Color(1f, 0.105f, 0.012f, 1f), false, true);
            }

            if (surface.Kind == DungeonSurfaceKindV2.Hazard)
            {
                return GetOrCreateMaterial("hazard-electric", new Color(0.08f, 0.72f, 1f, 1f), false, true);
            }

            if (surface.Kind == DungeonSurfaceKindV2.WaterBed)
            {
                return GetOrCreateMaterial("water-bed", new Color(0.035f, 0.16f, 0.22f, 1f), false, false);
            }

            if (surface.Kind == DungeonSurfaceKindV2.Rail)
            {
                return GetOrCreateMaterial("factory-rail", new Color(0.14f, 0.22f, 0.26f, 1f), false, false);
            }

            if (districtKind == DungeonBiomeDistrictKindV2.Waterworks)
            {
                return GetOrCreateMaterial(
                    surface.IsWalkable ? "waterworks-walkable" : "waterworks-structure",
                    surface.IsWalkable
                        ? new Color(0.10f, 0.30f, 0.33f, 1f)
                        : new Color(0.065f, 0.18f, 0.21f, 1f),
                    false,
                    false);
            }

            if (districtKind == DungeonBiomeDistrictKindV2.MagmaUndercroft)
            {
                return GetOrCreateMaterial(
                    surface.IsWalkable ? "magma-safe-plate" : "magma-structure",
                    surface.IsWalkable
                        ? new Color(0.31f, 0.20f, 0.15f, 1f)
                        : new Color(0.16f, 0.105f, 0.09f, 1f),
                    false,
                    false);
            }

            if (districtKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
            {
                return GetOrCreateMaterial(
                    surface.IsWalkable ? "electric-safe-plate" : "electric-structure",
                    surface.IsWalkable
                        ? new Color(0.16f, 0.22f, 0.34f, 1f)
                        : new Color(0.075f, 0.11f, 0.19f, 1f),
                    false,
                    false);
            }

            return GetOrCreateMaterial(
                surface.IsWalkable ? "factory-walkable" : "factory-structure",
                surface.IsWalkable
                    ? new Color(0.27f, 0.37f, 0.40f, 1f)
                    : new Color(0.15f, 0.23f, 0.26f, 1f),
                false,
                false);
        }

        private Material ResolveDistrictPrimaryMaterial(DungeonBiomeDistrictKindV2 districtKind)
        {
            switch (districtKind)
            {
                case DungeonBiomeDistrictKindV2.Waterworks:
                    return GetOrCreateMaterial("landmark-waterworks", new Color(0.08f, 0.52f, 0.58f, 1f), false, true);
                case DungeonBiomeDistrictKindV2.MagmaUndercroft:
                    return GetOrCreateMaterial("landmark-magma", new Color(0.48f, 0.18f, 0.08f, 1f), false, false);
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft:
                    return GetOrCreateMaterial("landmark-electric", new Color(0.14f, 0.31f, 0.58f, 1f), false, true);
                default:
                    return GetOrCreateMaterial("landmark-factory", new Color(0.30f, 0.48f, 0.50f, 1f), false, false);
            }
        }

        private Material ResolveDistrictAccentMaterial(DungeonBiomeDistrictKindV2 districtKind)
        {
            switch (districtKind)
            {
                case DungeonBiomeDistrictKindV2.Waterworks:
                    return GetOrCreateMaterial("accent-waterworks", new Color(0.16f, 0.88f, 0.92f, 1f), false, true);
                case DungeonBiomeDistrictKindV2.MagmaUndercroft:
                    return GetOrCreateMaterial("accent-magma", new Color(1f, 0.30f, 0.035f, 1f), false, true);
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft:
                    return GetOrCreateMaterial("accent-electric", new Color(0.30f, 0.88f, 1f, 1f), false, true);
                default:
                    return GetOrCreateMaterial("accent-factory", new Color(0.92f, 0.72f, 0.18f, 1f), false, true);
            }
        }

        private Material GetOrCreateMaterial(string key, Color color, bool transparent, bool emissive)
        {
            if (ownedMaterials.TryGetValue(key, out Material existing)) return existing;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { name = "V2_" + key };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", 0f);
            if (emissive)
            {
                material.EnableKeyword("_EMISSION");
                if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * 1.8f);
            }

            if (transparent)
            {
                material.renderQueue = (int)RenderQueue.Transparent;
                material.SetOverrideTag("RenderType", "Transparent");
                if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
                if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
                if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }

            ownedMaterials.Add(key, material);
            return material;
        }

        private static DungeonHazardSurfaceKindV2 ResolveHazardKind(string regionId, DungeonPlanV2 plan)
        {
            return ResolveDistrictKind(regionId, plan) == DungeonBiomeDistrictKindV2.ElectricalUndercroft
                ? DungeonHazardSurfaceKindV2.Electric
                : DungeonHazardSurfaceKindV2.Magma;
        }

        private static DungeonBiomeDistrictKindV2 ResolveDistrictKind(string regionId, DungeonPlanV2 plan)
        {
            DungeonRegionPlanV2 region = plan.Regions.FirstOrDefault(value => value.Id == regionId);
            DungeonBiomeDistrictPlanV2 district = region != null
                ? plan.Districts.FirstOrDefault(value => value.Id == region.BiomeDistrictId)
                : null;
            return district?.Kind ?? DungeonBiomeDistrictKindV2.Factory;
        }

        private bool Fail(string message, out string error)
        {
            LastError = message;
            error = message;
            Debug.LogError("[RuinCrawler Dungeon V2] " + message, this);
            return false;
        }

        private static string Sanitize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "seed";
            return new string(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
        }

        private int ResolveWorldGeometryLayer()
        {
            return worldGeometryLayer >= 0
                ? worldGeometryLayer
                : LayerMask.NameToLayer("WorldGeometry");
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
