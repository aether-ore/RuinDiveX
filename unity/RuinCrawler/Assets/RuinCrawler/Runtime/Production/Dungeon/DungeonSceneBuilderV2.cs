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
    /// Sole production V2 assembly boundary. It instantiates the exact authored
    /// prefab revision named by the immutable plan and refuses missing or stale
    /// content. There is deliberately no staging or legacy geometry fallback.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonSceneBuilderV2 : MonoBehaviour
    {
        [SerializeField] private Transform generatedParent;
        [SerializeField] private bool addFallbackRecovery = true;
        [SerializeField] private DungeonAuthoredModuleRegistryV2 authoredModuleRegistry;
        [SerializeField] private bool allowAuthoredRegistryResourceFallback = true;
        [SerializeField] private bool createLocalNavigation = true;
        [SerializeField] private bool bakeLocalNavigationOnBuild;
        [SerializeField] private int worldGeometryLayer = -1;

        private readonly List<Mesh> ownedHelperMeshes = new List<Mesh>();
        private readonly Dictionary<string, ResolvedAuthoredModuleV2> resolvedModules =
            new Dictionary<string, ResolvedAuthoredModuleV2>(StringComparer.Ordinal);

        public DungeonPlanV2 CurrentPlan => CurrentInstance?.Plan;
        public DungeonSceneInstanceV2 CurrentInstance { get; private set; }
        public GameObject GeneratedRoot => CurrentInstance?.Root;
        public string LastError { get; private set; }
        public int CertifiedModuleCount { get; private set; }
        public bool AuthoredContentPathActive => true;

        public void ConfigureAuthoredModuleRegistry(
            DungeonAuthoredModuleRegistryV2 registry,
            bool allowResourceFallback = true)
        {
            authoredModuleRegistry = registry;
            allowAuthoredRegistryResourceFallback = allowResourceFallback;
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

            DungeonAuthoredModuleRegistryV2 requestedRegistry = authoredModuleRegistry;
            if (requestedRegistry == null && allowAuthoredRegistryResourceFallback)
                requestedRegistry = Resources.Load<DungeonAuthoredModuleRegistryV2>(
                    DungeonAuthoredModuleRegistryV2.ResourcePath);
            if (!DungeonAuthoredModuleRegistryV2.TryResolveProductionCatalog(
                    requestedRegistry,
                    out DungeonAuthoredModuleRegistryV2 resolvedRegistry,
                    out DungeonAuthoredModuleCatalogV2 pureCatalog,
                    out string catalogError))
            {
                return Fail("V2 authored catalog validation failed: " + catalogError, out error);
            }
            authoredModuleRegistry = resolvedRegistry;

            IndustrialFactoryV2ValidationResult validation =
                new IndustrialFactoryV2Validator(pureCatalog).Validate(plan);
            if (!validation.Accepted)
            {
                return Fail(
                    "V2 scene assembly rejected an invalid plan: "
                        + string.Join(" | ", validation.Errors.Select(value => value.ToString())),
                    out error);
            }

            if (!TryValidateAuthoredModules(plan, out string certificationError))
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
                BuildAuthoredModules(instance);
                BindConnectorCaps(instance);
                BuildRegions(instance);
                BindSurfaces(instance);
                BindAnchors(instance);
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
            foreach (Mesh mesh in ownedHelperMeshes)
            {
                if (mesh != null) DestroyOwned(mesh);
            }

            ownedHelperMeshes.Clear();
            resolvedModules.Clear();
        }

        private void OnDestroy()
        {
            TearDown();
        }

        private bool TryValidateAuthoredModules(DungeonPlanV2 plan, out string error)
        {
            resolvedModules.Clear();
            DungeonAuthoredModuleRegistryV2 registry = authoredModuleRegistry;
            if (registry == null && allowAuthoredRegistryResourceFallback)
                registry = Resources.Load<DungeonAuthoredModuleRegistryV2>(
                    DungeonAuthoredModuleRegistryV2.ResourcePath);

            if (registry == null)
            {
                CertifiedModuleCount = 0;
                error = "V2 scene assembly requires DungeonAuthoredModuleRegistryV2. "
                    + "Run Bake and Validate Authored Module Library after every hand-authored prefab passes its content gates.";
                return false;
            }

            foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
            {
                if (!registry.TryResolve(
                    module,
                    out DungeonAuthoredModuleEntryV2 entry,
                    out CertifiedDungeonModuleGeometryV2 geometry,
                    out string resolutionError))
                {
                    CertifiedModuleCount = 0;
                    resolvedModules.Clear();
                    error = "V2 authored module resolution failed for '" + module.Id + "' (template '"
                        + module.TemplateId + "'): " + resolutionError;
                    return false;
                }

                IReadOnlyList<IndustrialFactoryV2ValidationIssue> placementErrors =
                    DungeonCertifiedModulePlacementValidatorV2.ValidateModule(plan, module, geometry);
                if (placementErrors.Count > 0)
                {
                    CertifiedModuleCount = 0;
                    resolvedModules.Clear();
                    error = "V2 authored module placement failed for '" + module.Id + "' (template '"
                        + module.TemplateId + "'): "
                        + string.Join(" | ", placementErrors.Select(value => value.ToString()));
                    return false;
                }

                resolvedModules.Add(module.Id, new ResolvedAuthoredModuleV2(module, entry, geometry));
            }

            CertifiedModuleCount = resolvedModules.Count;
            error = string.Empty;
            return true;
        }

        private void BuildAuthoredModules(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("AuthoredModules");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonModuleInstancePlanV2 planModule in instance.Plan.Modules
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                ResolvedAuthoredModuleV2 resolved = resolvedModules[planModule.Id];
                DungeonModuleTransformV2 placement = planModule.Transform;
                Vector3 position = DungeonUnityCoordinates.ToUnity(placement.Translation);
                Quaternion rotation = Quaternion.Euler(0f, -90f * placement.QuarterTurns, 0f);
                GameObject moduleRoot = Instantiate(
                    resolved.Entry.PresentationPrefab,
                    position,
                    rotation,
                    container.transform);
                moduleRoot.name = "Module_" + planModule.Id;
                moduleRoot.transform.localScale = Vector3.one;
                moduleRoot.AddComponent<DungeonAuthoredModuleRuntimeV2>()
                    .Configure(planModule, resolved.Entry);
                resolved.BindInstance(moduleRoot);
                instance.AddAuthoredModule(moduleRoot);
            }
        }

        private void BindConnectorCaps(DungeonSceneInstanceV2 instance)
        {
            DungeonModuleConnectorPlanV2[] connectors = instance.Plan.Connectors
                .Where(value => value.Source == DungeonSpatialRecordSourceV2.CertifiedModule)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            var connectorById = connectors.ToDictionary(value => value.Id, StringComparer.Ordinal);
            var openedConnectorIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonAbstractRouteEdgeV2 edge in instance.Plan.AbstractRouteGraph.Edges)
            {
                if (edge.FromConnectorId == null || edge.ToConnectorId == null
                    || !connectorById.TryGetValue(edge.FromConnectorId, out DungeonModuleConnectorPlanV2 from)
                    || !connectorById.TryGetValue(edge.ToConnectorId, out DungeonModuleConnectorPlanV2 to))
                {
                    throw new InvalidOperationException(
                        "Abstract route edge '" + edge.Id
                        + "' does not declare two known certified connector IDs.");
                }

                if (!string.Equals(from.ModuleInstanceId, edge.FromNodeId, StringComparison.Ordinal)
                    || !string.Equals(to.ModuleInstanceId, edge.ToNodeId, StringComparison.Ordinal)
                    || !DungeonAbstractRouteSocketValidatorV2.IsExactPair(from, to))
                {
                    throw new InvalidOperationException(
                        "Abstract route edge '" + edge.Id
                        + "' does not own an exact certified connector pair.");
                }

                if (!openedConnectorIds.Add(from.Id) || !openedConnectorIds.Add(to.Id))
                {
                    throw new InvalidOperationException(
                        "Abstract route edge '" + edge.Id
                        + "' reuses a connector already consumed by another route edge.");
                }
            }

            foreach (DungeonModuleConnectorPlanV2 connector in connectors)
            {
                DungeonConnectorApertureV2 aperture = connector.Aperture;
                if (aperture == null || aperture.CapState == DungeonConnectorCapStateV2.PermanentlyOpen)
                    continue;

                if (openedConnectorIds.Contains(connector.Id)
                    && aperture.CapState == DungeonConnectorCapStateV2.RequiredWhenUnused)
                    continue;

                if (!resolvedModules.TryGetValue(connector.ModuleInstanceId, out ResolvedAuthoredModuleV2 module)
                    || !module.TryResolveConnector(connector, out DungeonConnectorGeometryAuthoringV2 marker))
                    throw new InvalidOperationException("Authored connector cap binding failed for '" + connector.Id + "'.");
                if (marker.ThemedCapPrefab == null)
                    throw new InvalidOperationException("Authored connector '" + connector.Id + "' has no themed cap prefab.");

                GameObject cap = Instantiate(marker.ThemedCapPrefab, marker.transform, false);
                cap.name = "ConnectorCap_" + Sanitize(connector.Id);
                cap.transform.localPosition = Vector3.zero;
                cap.transform.localRotation = Quaternion.identity;
                cap.transform.localScale = Vector3.one;
                cap.AddComponent<DungeonConnectorCapRuntimeV2>().Configure(
                    connector.Id,
                    aperture.CapState,
                    aperture.MechanismBindingId);
            }
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

        private void BindSurfaces(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("InvisibleSurfaceRuntimeHelpers");
            container.transform.SetParent(instance.Root.transform, false);
            var hazardContainer = new GameObject("HazardDistricts");
            hazardContainer.transform.SetParent(instance.Root.transform, false);
            var hazardDistricts = new Dictionary<string, DungeonHazardDistrictRuntimeV2>(StringComparer.Ordinal);
            foreach (DungeonSurfacePlanV2 surface in instance.Plan.Surfaces)
            {
                string bindingError = null;
                if (!resolvedModules.TryGetValue(surface.ModuleInstanceId, out ResolvedAuthoredModuleV2 module)
                    || !module.TryResolveSurface(
                        surface,
                        out DungeonSurfaceGeometryAuthoringV2 surfaceMarker,
                        out DungeonRuntimeBindingAuthoringV2 presentationBinding,
                        out bindingError))
                {
                    throw new InvalidOperationException(
                        "Authored surface binding failed for '" + surface.Id + "': " + bindingError);
                }

                DungeonBiomeDistrictKindV2 districtKind = ResolveDistrictKind(surface.RegionId, instance.Plan);
                GameObject target = surfaceMarker.gameObject;
                int geometryLayer = ResolveWorldGeometryLayer();
                if (geometryLayer >= 0) target.layer = geometryLayer;
                instance.Environment.RegisterPredicateTarget(target, surface.ActivePredicate);
                if (presentationBinding != null && presentationBinding.Target != target)
                    instance.Environment.RegisterPredicateTarget(presentationBinding.Target, surface.ActivePredicate);

                ConfigureAuthoredSurfaceMechanism(
                    target,
                    presentationBinding != null ? presentationBinding.Target : null,
                    surface,
                    instance.Environment,
                    container.transform);
                instance.SurfaceCount += 1;
                if (surface.Kind != DungeonSurfaceKindV2.Hazard) continue;

                DungeonHazardSurfaceKindV2 hazardKind = ResolveHazardKind(surface.RegionId, instance.Plan);
                string controllerId = !string.IsNullOrWhiteSpace(surface.ControllerId)
                    ? surface.ControllerId
                    : "hazard-" + hazardKind.ToString().ToLowerInvariant() + "-" + surface.RegionId;
                string districtKey = hazardKind + "|" + controllerId;
                if (!hazardDistricts.TryGetValue(districtKey, out DungeonHazardDistrictRuntimeV2 hazardDistrict))
                {
                    var districtObject = new GameObject("HazardDistrict_" + Sanitize(controllerId));
                    districtObject.transform.SetParent(hazardContainer.transform, false);
                    districtObject.transform.position = CenterOf(surface.Volume);
                    hazardDistrict = districtObject.AddComponent<DungeonHazardDistrictRuntimeV2>();
                    hazardDistrict.Configure(
                        hazardKind,
                        controllerId,
                        instance.Environment,
                        simulateAutomatically: true);
                    AudioSource authoredAudio = presentationBinding?.Target
                        .GetComponentInChildren<AudioSource>(true);
                    if (authoredAudio != null)
                    {
                        DungeonHazardAudioPresentationV2 audio =
                            authoredAudio.GetComponent<DungeonHazardAudioPresentationV2>()
                            ?? authoredAudio.gameObject.AddComponent<DungeonHazardAudioPresentationV2>();
                        audio.Configure(hazardDistrict);
                    }
                    hazardDistricts.Add(districtKey, hazardDistrict);
                }

                GameObject trigger = CreateInvisiblePrismTrigger(
                    "HazardTrigger_" + surface.Id,
                    surface.Volume,
                    container.transform);
                trigger.AddComponent<DungeonHazardSurfaceRuntimeV2>()
                    .Configure(surface.Id, surface.RegionId, hazardKind);
                Renderer authoredRenderer = presentationBinding?.Target.GetComponentInChildren<Renderer>(true);
                if (authoredRenderer != null)
                {
                    DungeonHazardSurfaceVisualV2 visual =
                        authoredRenderer.GetComponent<DungeonHazardSurfaceVisualV2>()
                        ?? authoredRenderer.gameObject.AddComponent<DungeonHazardSurfaceVisualV2>();
                    visual.Configure(authoredRenderer, hazardDistrict);
                }
                trigger.AddComponent<DungeonHazardTileRelayV2>()
                    .Configure(surface.Id, hazardDistrict);
                instance.HazardSurfaceCount += 1;
            }
        }

        private static void ConfigureAuthoredSurfaceMechanism(
            GameObject certifiedTarget,
            GameObject presentationTarget,
            DungeonSurfacePlanV2 surface,
            DungeonEnvironmentRuntimeV2 environment,
            Transform helperParent)
        {
            GameObject target = certifiedTarget;
            if (surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
            {
                // Certified collision and authored presentation live in separate
                // prefab hierarchies. At runtime they must move as one rigid body;
                // leaving the renderer behind would make the visible platform
                // disagree with the authoritative traversal surface.
                if (presentationTarget != null && presentationTarget != certifiedTarget)
                {
                    var pivot = new GameObject("MovingPlatformPivot_" + surface.Id);
                    pivot.transform.SetParent(helperParent, true);
                    pivot.transform.SetPositionAndRotation(
                        certifiedTarget.transform.position,
                        certifiedTarget.transform.rotation);
                    certifiedTarget.transform.SetParent(pivot.transform, true);
                    presentationTarget.transform.SetParent(pivot.transform, true);
                    target = pivot;
                }

                var body = target.AddComponent<Rigidbody>();
                body.isKinematic = true;
                body.useGravity = false;
                body.interpolation = RigidbodyInterpolation.Interpolate;

                var platform = target.AddComponent<DungeonMovingPlatformRuntimeV2>();
                platform.Configure(body, target.transform.forward, distance: 2.5f, periodSeconds: 4f);

                GameObject riderTrigger = CreateInvisibleBoxTrigger(
                    "RiderTrigger_" + surface.Id,
                    surface.Volume,
                    helperParent,
                    0.8f);
                riderTrigger.transform.SetParent(target.transform, true);
                riderTrigger.AddComponent<DungeonMovingPlatformRiderRelayV2>().Configure(platform);
            }

            if (!surface.IsWalkable
                || !string.Equals(
                    surface.ControllerId,
                    IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                    StringComparison.Ordinal))
            {
                return;
            }

            var crumble = target.AddComponent<DungeonCrumbleSurfaceRuntimeV2>();
            crumble.Configure(
                environment,
                IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                "collapse-credential-tower-platform");
            GameObject crumbleTrigger = CreateInvisibleBoxTrigger(
                "CrumbleTrigger_" + surface.Id,
                surface.Volume,
                helperParent,
                0.65f);
            crumbleTrigger.transform.SetParent(target.transform, true);
            crumbleTrigger.AddComponent<DungeonCrumbleSurfaceRelayV2>().Configure(crumble);
        }

        private void BindAnchors(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("InvisibleAnchorRuntimeHelpers");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonAnchorPlanV2 anchor in instance.Plan.Anchors)
            {
                if (!resolvedModules.TryGetValue(anchor.ModuleInstanceId, out ResolvedAuthoredModuleV2 module)
                    || !module.TryResolveBinding(
                        DungeonRuntimeBindingKindV2.Anchor,
                        anchor.Id,
                        anchor.RegionId,
                        anchor.ProfileId,
                        out DungeonRuntimeBindingAuthoringV2 binding))
                {
                    throw new InvalidOperationException(
                        "Authored anchor binding is missing for '" + anchor.Id + "' in module '"
                            + anchor.ModuleInstanceId + "'.");
                }

                GameObject target = binding.Target;
                Vector3 expectedPosition = DungeonUnityCoordinates.ToUnity(anchor.Position);
                if ((target.transform.position - expectedPosition).sqrMagnitude > 0.0001f)
                {
                    throw new InvalidOperationException(
                        "Authored anchor '" + anchor.Id + "' does not match its certified plan position.");
                }

                target.AddComponent<DungeonAnchorRuntimeV2>().Configure(anchor);
                if (anchor.Kind == DungeonAnchorKindV2.Safe && instance.Fallback != null)
                {
                    var trigger = target.AddComponent<SphereCollider>();
                    trigger.isTrigger = true;
                    trigger.radius = 1f;
                    target.AddComponent<DungeonSafeAnchorRuntimeV2>().Configure(instance.Fallback);
                }

                if (anchor.Kind == DungeonAnchorKindV2.Console
                    && !string.IsNullOrWhiteSpace(anchor.ProfileId)
                    && instance.Plan.EnvironmentControllers.Any(value => value.Id == anchor.ProfileId))
                {
                    target.AddComponent<DungeonEnvironmentConsoleRuntimeV2>().Configure(
                        anchor.ProfileId,
                        instance.Environment,
                        instance.Minimap,
                        FindAuthoredPrompt(binding.Target));
                }

                if (anchor.Kind == DungeonAnchorKindV2.ShortcutActivation
                    && !string.IsNullOrWhiteSpace(anchor.ProfileId))
                {
                    target.AddComponent<DungeonShortcutInteractionRuntimeV2>().Configure(
                        anchor.ProfileId,
                        instance.Environment,
                        instance.Minimap,
                        FindAuthoredPrompt(binding.Target));
                }

                instance.AnchorCount += 1;
            }
        }

        private void BuildKeySeeker(DungeonSceneInstanceV2 instance, Vector3 entrancePosition)
        {
            DungeonModuleInstancePlanV2 entranceModule = instance.Plan.Modules.FirstOrDefault(value =>
                value.RegionIds.Contains(instance.Plan.EntranceRegionId));
            if (entranceModule == null
                || !resolvedModules[entranceModule.Id].TryResolveBinding(
                    DungeonRuntimeBindingKindV2.Mechanism,
                    "key-seeker",
                    instance.Plan.EntranceRegionId,
                    "key-seeker-v2",
                    out DungeonRuntimeBindingAuthoringV2 binding))
            {
                throw new InvalidOperationException(
                    "Security Entrance authored module is missing the required key-seeker mechanism binding.");
            }

            GameObject target = binding.Target;
            target.AddComponent<DungeonKeySeekerRuntimeV2>().Configure(
                instance.Plan,
                instance.Environment,
                instance.Minimap,
                FindAuthoredPrompt(binding.Target));
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

                DungeonRuntimeBindingAuthoringV2 binding = source.GetComponent<DungeonRuntimeBindingAuthoringV2>();
                source.gameObject.AddComponent<DungeonLiftInteractionRuntimeV2>().Configure(
                    edge,
                    destination.transform,
                    instance.Environment,
                    instance.Minimap,
                    FindAuthoredPrompt(binding != null ? binding.Target : source.gameObject));
            }
        }

        private static TextMesh FindAuthoredPrompt(GameObject target)
        {
            return target != null ? target.GetComponentInChildren<TextMesh>(true) : null;
        }

        private void BuildFluids(DungeonSceneInstanceV2 instance)
        {
            var container = new GameObject("InvisibleFluidRuntimeHelpers");
            container.transform.SetParent(instance.Root.transform, false);
            foreach (DungeonFluidZonePlanV2 fluid in instance.Plan.FluidZones)
            {
                DungeonRegionPlanV2 region = instance.Plan.Regions.First(value => value.Id == fluid.RegionId);
                ResolvedAuthoredModuleV2 module = resolvedModules[region.ModuleInstanceIds[0]];
                if (!module.TryResolveBinding(
                    DungeonRuntimeBindingKindV2.FluidSurface,
                    fluid.Id,
                    fluid.RegionId,
                    fluid.FluidNetworkId,
                    out DungeonRuntimeBindingAuthoringV2 binding))
                {
                    throw new InvalidOperationException(
                        "Authored fluid-surface binding is missing for '" + fluid.Id + "'.");
                }

                GameObject target = binding.Target;
                GameObject trigger = CreateInvisiblePrismTrigger(
                    "FluidTrigger_" + fluid.Id,
                    fluid.Volume,
                    container.transform);
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

        private GameObject CreateInvisiblePrismTrigger(
            string name,
            DungeonConvexPrismV2 prism,
            Transform parent)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            Mesh mesh = BuildPrismMesh(prism, name + "_Mesh");
            ownedHelperMeshes.Add(mesh);
            var collider = target.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
            collider.convex = true;
            collider.isTrigger = true;
            return target;
        }

        private static GameObject CreateInvisibleBoxTrigger(
            string name,
            DungeonConvexPrismV2 prism,
            Transform parent,
            float extraHeight)
        {
            var target = new GameObject(name);
            target.transform.SetParent(parent, false);
            double minimumX = prism.HorizontalVertices.Min(value => value.X);
            double maximumX = prism.HorizontalVertices.Max(value => value.X);
            double minimumZ = prism.HorizontalVertices.Min(value => value.Z);
            double maximumZ = prism.HorizontalVertices.Max(value => value.Z);
            target.transform.position = DungeonUnityCoordinates.ToUnity(
                (minimumX + maximumX) * 0.5d,
                (prism.MinimumY + prism.MaximumY + extraHeight) * 0.5d,
                (minimumZ + maximumZ) * 0.5d);
            var collider = target.AddComponent<BoxCollider>();
            collider.isTrigger = true;
            collider.size = new Vector3(
                (float)(maximumX - minimumX),
                (float)(prism.MaximumY - prism.MinimumY) + extraHeight,
                (float)(maximumZ - minimumZ));
            return target;
        }

        private static Vector3 CenterOf(DungeonConvexPrismV2 prism)
        {
            double minimumX = prism.HorizontalVertices.Min(value => value.X);
            double maximumX = prism.HorizontalVertices.Max(value => value.X);
            double minimumZ = prism.HorizontalVertices.Min(value => value.Z);
            double maximumZ = prism.HorizontalVertices.Max(value => value.Z);
            return DungeonUnityCoordinates.ToUnity(
                (minimumX + maximumX) * 0.5d,
                (prism.MinimumY + prism.MaximumY) * 0.5d,
                (minimumZ + maximumZ) * 0.5d);
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

        private sealed class ResolvedAuthoredModuleV2
        {
            private readonly Dictionary<string, string> localRegionByPlaced =
                new Dictionary<string, string>(StringComparer.Ordinal);
            private readonly Dictionary<string, DungeonSurfaceGeometryAuthoringV2> surfaces =
                new Dictionary<string, DungeonSurfaceGeometryAuthoringV2>(StringComparer.Ordinal);
            private readonly Dictionary<string, DungeonConnectorGeometryAuthoringV2> connectors =
                new Dictionary<string, DungeonConnectorGeometryAuthoringV2>(StringComparer.Ordinal);
            private DungeonRuntimeBindingAuthoringV2[] bindings =
                Array.Empty<DungeonRuntimeBindingAuthoringV2>();

            public ResolvedAuthoredModuleV2(
                DungeonModuleInstancePlanV2 plan,
                DungeonAuthoredModuleEntryV2 entry,
                CertifiedDungeonModuleGeometryV2 geometry)
            {
                Plan = plan;
                Entry = entry;
                Geometry = geometry;
                foreach (DungeonModuleRegionBindingV2 binding in plan.RegionBindings)
                    localRegionByPlaced.Add(binding.PlacedRegionId, binding.LocalRegionId);
            }

            public DungeonModuleInstancePlanV2 Plan { get; }
            public DungeonAuthoredModuleEntryV2 Entry { get; }
            public CertifiedDungeonModuleGeometryV2 Geometry { get; }
            public GameObject Instance { get; private set; }

            public void BindInstance(GameObject instance)
            {
                Instance = instance ?? throw new ArgumentNullException(nameof(instance));
                DungeonModuleGeometryAuthoringV2 authoring =
                    instance.GetComponent<DungeonModuleGeometryAuthoringV2>();
                if (authoring == null)
                    throw new InvalidOperationException(Plan.Id + ": prefab lost its module authoring root.");
                if (!authoring.HasAuthoredHierarchy(out string error))
                    throw new InvalidOperationException(Plan.Id + ": " + error);
                foreach (DungeonSurfaceGeometryAuthoringV2 surface in
                    authoring.CertifiedGeometryRoot.GetComponentsInChildren<DungeonSurfaceGeometryAuthoringV2>(true))
                {
                    string key = surface.RegionId + "|" + surface.StableId;
                    if (!surfaces.TryAdd(key, surface))
                        throw new InvalidOperationException(Plan.Id + " duplicates certified surface '" + key + "'.");
                }
                foreach (DungeonConnectorGeometryAuthoringV2 connector in
                    authoring.CertifiedGeometryRoot.GetComponentsInChildren<DungeonConnectorGeometryAuthoringV2>(true))
                {
                    string key = connector.RegionId + "|" + connector.StableId;
                    if (!connectors.TryAdd(key, connector))
                        throw new InvalidOperationException(Plan.Id + " duplicates certified connector '" + key + "'.");
                }
                bindings = authoring.RuntimeBindingsRoot
                    .GetComponentsInChildren<DungeonRuntimeBindingAuthoringV2>(true);
            }

            public bool TryResolveConnector(
                DungeonModuleConnectorPlanV2 placed,
                out DungeonConnectorGeometryAuthoringV2 marker)
            {
                marker = null;
                if (!localRegionByPlaced.TryGetValue(placed.RegionId, out string localRegionId)) return false;
                CertifiedDungeonConnectorGeometryV2 local = Geometry.Connectors.FirstOrDefault(value =>
                    string.Equals(value.RegionId, localRegionId, StringComparison.Ordinal)
                    && string.Equals(
                        DungeonCertifiedModulePlacementV2.PlacedConnectorId(placed.RegionId, value.Id),
                        placed.Id,
                        StringComparison.Ordinal));
                return local != null && connectors.TryGetValue(localRegionId + "|" + local.Id, out marker);
            }

            public bool TryResolveSurface(
                DungeonSurfacePlanV2 placed,
                out DungeonSurfaceGeometryAuthoringV2 marker,
                out DungeonRuntimeBindingAuthoringV2 presentation,
                out string error)
            {
                marker = null;
                presentation = null;
                if (!localRegionByPlaced.TryGetValue(placed.RegionId, out string localRegionId))
                {
                    error = "placed region '" + placed.RegionId + "' is absent from module region bindings.";
                    return false;
                }

                CertifiedDungeonSurfaceGeometryV2 local = Geometry.Surfaces.FirstOrDefault(value =>
                    string.Equals(value.RegionId, localRegionId, StringComparison.Ordinal)
                    && string.Equals(
                        DungeonCertifiedModulePlacementV2.PlacedSurfaceId(placed.RegionId, value.Id),
                        placed.Id,
                        StringComparison.Ordinal));
                if (local == null)
                {
                    error = "plan surface is not present in certified prefab geometry.";
                    return false;
                }

                if (!surfaces.TryGetValue(localRegionId + "|" + local.Id, out marker))
                {
                    error = "prefab is missing certified surface marker '" + local.Id + "'.";
                    return false;
                }

                TryResolveBinding(
                    DungeonRuntimeBindingKindV2.Surface,
                    placed.Id,
                    placed.RegionId,
                    placed.MaterialProfileId,
                    out presentation);
                error = string.Empty;
                return true;
            }

            public bool TryResolveBinding(
                DungeonRuntimeBindingKindV2 kind,
                string placedId,
                string placedRegionId,
                string profileId,
                out DungeonRuntimeBindingAuthoringV2 binding)
            {
                binding = null;
                if (!localRegionByPlaced.TryGetValue(placedRegionId, out string localRegionId))
                    return false;
                foreach (DungeonRuntimeBindingAuthoringV2 candidate in bindings)
                {
                    if (candidate.Kind != kind
                        || !string.Equals(candidate.LocalRegionId, localRegionId, StringComparison.Ordinal))
                        continue;
                    bool idMatch = string.Equals(candidate.StableId, placedId, StringComparison.Ordinal)
                        || (kind == DungeonRuntimeBindingKindV2.Anchor
                            && string.Equals(
                                DungeonCertifiedModulePlacementV2.PlacedAnchorId(placedRegionId, candidate.StableId),
                                placedId,
                                StringComparison.Ordinal))
                        || (kind == DungeonRuntimeBindingKindV2.Surface
                            && string.Equals(
                                DungeonCertifiedModulePlacementV2.PlacedSurfaceId(placedRegionId, candidate.StableId),
                                placedId,
                                StringComparison.Ordinal));
                    bool profileMatch = !string.IsNullOrWhiteSpace(profileId)
                        && string.Equals(candidate.ProfileId, profileId, StringComparison.Ordinal);
                    if (!idMatch && !profileMatch) continue;
                    if (binding != null)
                        throw new InvalidOperationException(
                            "Ambiguous authored runtime bindings for '" + placedId + "'.");
                    binding = candidate;
                }
                return binding != null;
            }
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
