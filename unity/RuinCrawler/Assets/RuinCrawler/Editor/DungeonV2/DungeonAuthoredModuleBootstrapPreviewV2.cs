using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RuinCrawler.Editor.DungeonV2
{
    /// <summary>
    /// Development-only bootstrap preview. It creates transient, unsaved scene
    /// objects so artists can inspect the pure catalog's certified geometry and
    /// presentation requirements before hand-authoring source prefabs. It does
    /// not write assets, is excluded from builds and cutover, and its output is
    /// never accepted as production authored content.
    /// </summary>
    public static class DungeonAuthoredModuleBootstrapPreviewV2
    {
        private const string PreviewRootName = "DungeonV2_BOOTSTRAP_PREVIEW_NOT_PRODUCTION";
        private const string LargeRefractorRewardProfileId = "large-refractor-reward-v2";
        private const float GeometryTolerance = 0.0002f;

        private static readonly string[] OptionalExtractedPropPrefabs =
        {
            "Assets/RuinCrawler/Art/DungeonV2/ImportedProps/server_crypt_source/server_crypt_source.prefab",
            "Assets/RuinCrawler/Art/DungeonV2/ImportedProps/coolant_works_source/coolant_works_source.prefab",
            "Assets/RuinCrawler/Art/DungeonV2/ImportedProps/machine_factory_source/machine_factory_source.prefab"
        };

        [MenuItem("RuinCrawler/Dungeon V2/Development/Build Transient Bootstrap Preview (Not Production)")]
        public static void BuildTransientPreviewMenu()
        {
            try
            {
                int count = BuildTransientPreview();
                Debug.Log("Created " + count
                    + " transient Dungeon V2 bootstrap previews. No prefab, mesh, geometry, or registry asset was written. "
                    + "These objects are not production authored modules and cannot satisfy cutover gates.");
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                throw;
            }
        }

        public static int BuildTransientPreview()
        {
            if (GameObject.Find(PreviewRootName) != null)
                throw new InvalidOperationException(
                    "A transient Dungeon V2 bootstrap preview already exists. Clear it before rebuilding.");

            IndustrialFactoryV2ModuleDefinition[] definitions =
                IndustrialFactoryV2ModuleCatalog.Definitions
                    .OrderBy(value => value.TemplateId, StringComparer.Ordinal)
                    .ToArray();
            ValidateManifest(definitions);

            MaterialSet materials = MaterialSet.LoadRequired();
            GameObject transientCap = BuildBulkheadCap(materials.FactoryWall);
            var builds = new List<ModuleBuild>(definitions.Length);
            GameObject previewRoot = null;
            try
            {
                foreach (IndustrialFactoryV2ModuleDefinition definition in definitions)
                {
                    ModuleBuild build = BuildModule(definition, materials, transientCap);
                    Preflight(build);
                    builds.Add(build);
                }

                previewRoot = new GameObject(PreviewRootName)
                {
                    hideFlags = HideFlags.DontSaveInEditor | HideFlags.DontSaveInBuild
                };
                Undo.RegisterCreatedObjectUndo(previewRoot, "Create Dungeon V2 bootstrap preview");
                transientCap.name = "_BootstrapConnectorCapSource";
                transientCap.transform.SetParent(previewRoot.transform, false);
                transientCap.SetActive(false);

                const int columns = 4;
                const float spacing = 68f;
                for (int index = 0; index < builds.Count; index += 1)
                {
                    ModuleBuild build = builds[index];
                    build.Root.name = "BOOTSTRAP_NOT_PRODUCTION__" + build.Definition.TemplateId;
                    build.Root.transform.SetParent(previewRoot.transform, false);
                    build.Root.transform.localPosition = new Vector3(
                        (index % columns) * spacing,
                        0f,
                        (index / columns) * spacing);
                }
                Selection.activeGameObject = previewRoot;
                return builds.Count;
            }
            catch
            {
                foreach (ModuleBuild build in builds) build.Dispose();
                if (transientCap != null) UnityEngine.Object.DestroyImmediate(transientCap);
                if (previewRoot != null) UnityEngine.Object.DestroyImmediate(previewRoot);
                throw;
            }
        }

        [MenuItem("RuinCrawler/Dungeon V2/Development/Clear Transient Bootstrap Preview")]
        public static void ClearTransientPreviewMenu()
        {
            GameObject previewRoot = GameObject.Find(PreviewRootName);
            if (previewRoot == null) return;
            foreach (MeshFilter filter in previewRoot.GetComponentsInChildren<MeshFilter>(true))
            {
                Mesh mesh = filter.sharedMesh;
                if (mesh != null && !AssetDatabase.Contains(mesh))
                    UnityEngine.Object.DestroyImmediate(mesh);
            }
            UnityEngine.Object.DestroyImmediate(previewRoot);
        }

        private static void ValidateManifest(IReadOnlyList<IndustrialFactoryV2ModuleDefinition> definitions)
        {
            if (definitions.Count != 24)
                throw new InvalidOperationException("The authored source manifest must contain exactly 24 templates.");
            if (definitions.Select(value => value.Composition.Archetype).Distinct().Count() != 12)
                throw new InvalidOperationException("The authored source manifest must contain exactly 12 families.");
            foreach (IGrouping<DungeonModuleArchetypeV2, IndustrialFactoryV2ModuleDefinition> family in
                definitions.GroupBy(value => value.Composition.Archetype))
            {
                IndustrialFactoryV2ModuleDefinition[] variants = family
                    .OrderBy(value => value.VariantId, StringComparer.Ordinal).ToArray();
                if (variants.Length != 2
                    || variants[0].VariantId != IndustrialFactoryV2ModuleCatalog.VariantA
                    || variants[1].VariantId != IndustrialFactoryV2ModuleCatalog.VariantB
                    || string.Equals(variants[0].TopologySignature, variants[1].TopologySignature,
                        StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("Family " + family.Key
                        + " must expose topology-distinct variant-a and variant-b descriptors.");
                }
            }
        }

        private static ModuleBuild BuildModule(
            IndustrialFactoryV2ModuleDefinition definition,
            MaterialSet materials,
            GameObject capPrefab)
        {
            var root = new GameObject(definition.TemplateId);
            root.transform.localScale = Vector3.one;
            Transform certifiedRoot = Child(root.transform, "CertifiedGeometry");
            Transform presentationRoot = Child(root.transform, "Presentation");
            Transform anchorTargetsRoot = Child(presentationRoot, "AnchorTargets");
            Transform bindingsRoot = Child(root.transform, "RuntimeBindings");
            var generatedMeshes = new List<GeneratedMesh>();
            var certifiedSurfaces = new Dictionary<string, DungeonSurfaceGeometryAuthoringV2>(StringComparer.Ordinal);
            var presentationSurfaces = new Dictionary<string, GameObject>(StringComparer.Ordinal);

            foreach (CertifiedDungeonRegionGeometryV2 region in definition.CertifiedGeometry.Regions)
                CreateRegionMarker(certifiedRoot, region);

            foreach (CertifiedDungeonSurfaceGeometryV2 surface in definition.CertifiedGeometry.Surfaces)
            {
                Mesh authoredMesh = surface.ColliderKind == CertifiedDungeonColliderKindV2.RampWedge
                    ? CreateRampMesh(surface)
                    : surface.ColliderKind == CertifiedDungeonColliderKindV2.ConvexMesh
                        ? CreatePrismMesh(surface.Volume, surface.Id)
                        : null;
                if (authoredMesh != null)
                    generatedMeshes.Add(new GeneratedMesh(surface.Id, authoredMesh));

                DungeonSurfaceGeometryAuthoringV2 marker = CreateCertifiedSurface(
                    certifiedRoot, surface, authoredMesh);
                GameObject visible = CreateVisibleSurface(
                    presentationRoot, surface, authoredMesh,
                    materials.ResolveSurface(definition, surface));
                certifiedSurfaces.Add(surface.Id, marker);
                presentationSurfaces.Add(surface.Id, visible);
                CreateRuntimeBinding(
                    bindingsRoot,
                    surface.Id,
                    surface.RegionId,
                    DungeonRuntimeBindingKindV2.Surface,
                    visible,
                    null);
            }

            foreach (CertifiedDungeonAnchorGeometryV2 anchor in definition.CertifiedGeometry.Anchors)
            {
                CreateAnchor(certifiedRoot, anchor);
                GameObject presentationTarget = CreateAnchorPresentation(
                    definition,
                    anchorTargetsRoot,
                    anchor,
                    materials);
                CreateRuntimeBinding(
                    bindingsRoot,
                    anchor.Id,
                    anchor.RegionId,
                    DungeonRuntimeBindingKindV2.Anchor,
                    presentationTarget,
                    anchor.ProfileId);
            }

            foreach (CertifiedDungeonConnectorGeometryV2 connector in definition.CertifiedGeometry.Connectors)
                CreateConnector(certifiedRoot, connector, capPrefab);

            var composition = root.AddComponent<DungeonModuleCompositionAuthoringV2>();
            DungeonModuleCompositionContractV2 contract = definition.Composition;
            composition.Configure(
                contract.Id,
                contract.Archetype,
                contract.SizeClass,
                contract.Districts,
                contract.TraversalTiers,
                contract.RequiredSemanticFeatures,
                contract.PlatformPurposes.Select(value => value.Purpose),
                contract.RequiredSupports,
                contract.MechanismProfiles,
                contract.StoryVignette,
                contract.LightingProfiles,
                contract.PropProfile,
                contract.MinimumRegions,
                contract.MinimumRouteDecisions,
                contract.RequiresInternalLoop,
                contract.RequiresRewardBranch);

            var topology = definition.TopologyEdges.Select(value =>
            {
                var edge = new DungeonModuleTopologyEdgeAuthoringDataV2();
                edge.Configure(value.Id, value.FromLocalRegionId, value.ToLocalRegionId,
                    value.Kind, value.Bidirectional);
                return edge;
            }).ToArray();
            root.AddComponent<DungeonModuleGenerationAuthoringV2>().Configure(
                definition.VariantId,
                definition.CompatibleMacroRoles,
                definition.VerticalCompositionId,
                topology);

            var authoring = root.AddComponent<DungeonModuleGeometryAuthoringV2>();
            authoring.ConfigureAuthored(
                definition.TemplateId,
                definition.DescriptorId,
                definition.Composition.Archetype.ToString(),
                definition.Composition.Id,
                certifiedRoot,
                presentationRoot,
                bindingsRoot);

            ModuleSpace space = ModuleSpace.From(definition.CertifiedGeometry);
            GameObject familyRoot = CreateFamilyPresentation(
                definition, presentationRoot, presentationSurfaces, space, materials);
            IReadOnlyList<DungeonStructuralSupportAuthoringV2> supports =
                CreateStructuralSupports(definition, presentationRoot, space, materials);
            CreatePlatformPurposeMarkers(
                contract, presentationRoot, certifiedSurfaces, supports);
            CreateMechanismStoryLightingAndProfile(
                definition, presentationRoot, familyRoot.transform, space, materials);
            CreateFluidBindingIfNeeded(
                definition, presentationRoot, bindingsRoot, presentationSurfaces, materials);
            CreateKeySeekerBindingIfNeeded(definition, presentationRoot, bindingsRoot, materials);
            TryAddOptionalExtractedSetDress(definition, familyRoot.transform, space);

            return new ModuleBuild(definition, root, authoring, generatedMeshes);
        }

        private static void Preflight(ModuleBuild build)
        {
            DungeonAuthoredModuleValidationResultV2 validation =
                DungeonAuthoredModuleValidatorV2.Validate(build.Root, requireCurrentBake: false);
            if (!validation.IsValid)
            {
                throw new InvalidOperationException(build.Definition.TemplateId + " failed bootstrap-preview preflight:\n"
                    + DungeonAuthoredModuleLibraryBakerV2.Format(validation.Issues));
            }
            build.BakedGeometry = validation.Geometry;
            EnsureUnityEquivalent(build.Definition.CertifiedGeometry, validation.Geometry);
        }

        private static void CreateRegionMarker(
            Transform parent,
            CertifiedDungeonRegionGeometryV2 region)
        {
            GameObject item = Empty(parent, "Region_" + region.Id);
            Vector3 minimum = ToUnity(region.Bounds.Minimum);
            Vector3 maximum = ToUnity(region.Bounds.Maximum);
            Vector3 low = Vector3.Min(minimum, maximum);
            Vector3 high = Vector3.Max(minimum, maximum);
            item.AddComponent<DungeonRegionGeometryAuthoringV2>().Configure(
                region.Id,
                (low + high) * 0.5f,
                high - low,
                region.DistrictKind,
                region.ElevationStratum,
                region.LocalNavigationRegionId);
        }

        private static DungeonSurfaceGeometryAuthoringV2 CreateCertifiedSurface(
            Transform parent,
            CertifiedDungeonSurfaceGeometryV2 surface,
            Mesh authoredMesh)
        {
            GameObject item = Empty(parent, "Surface_" + surface.Id);
            if (surface.ColliderKind == CertifiedDungeonColliderKindV2.Box)
            {
                Bounds bounds = ToUnityBounds(surface.Volume);
                item.transform.localPosition = bounds.center;
                var collider = item.AddComponent<BoxCollider>();
                collider.center = Vector3.zero;
                collider.size = bounds.size;
            }
            else
            {
                var collider = item.AddComponent<MeshCollider>();
                collider.sharedMesh = authoredMesh;
                collider.convex = true;
                if (surface.ColliderKind == CertifiedDungeonColliderKindV2.RampWedge)
                {
                    CertifiedDungeonRampWedgeV2 ramp = surface.RampWedge
                        ?? throw new InvalidOperationException(surface.Id + " has no exact ramp wedge.");
                    item.AddComponent<DungeonRampGeometryAuthoringV2>().Configure(
                        (float)ramp.LowSurfaceY,
                        (float)ramp.HighSurfaceY,
                        ToUnityDirection(ramp.RiseDirection));
                }
            }

            var marker = item.AddComponent<DungeonSurfaceGeometryAuthoringV2>();
            marker.Configure(
                surface.Id,
                surface.RegionId,
                surface.Kind,
                surface.IsStructural,
                surface.IsWalkable,
                surface.MaterialProfileId,
                surface.ActivePredicate,
                surface.ControllerId);
            return marker;
        }

        private static GameObject CreateVisibleSurface(
            Transform parent,
            CertifiedDungeonSurfaceGeometryV2 surface,
            Mesh authoredMesh,
            Material material)
        {
            GameObject item;
            if (surface.ColliderKind == CertifiedDungeonColliderKindV2.Box)
            {
                Bounds bounds = ToUnityBounds(surface.Volume);
                item = CreatePrimitiveWithoutCollider(
                    PrimitiveType.Cube,
                    parent,
                    "TexturedSurface_" + surface.Id,
                    bounds.center,
                    bounds.size,
                    Quaternion.identity,
                    material);
            }
            else
            {
                item = Empty(parent, "TexturedSurface_" + surface.Id);
                item.AddComponent<MeshFilter>().sharedMesh = authoredMesh;
                item.AddComponent<MeshRenderer>().sharedMaterial = material;
            }
            AddSurfaceIdentityPresentation(item.transform, surface, material);
            return item;
        }

        private static void AddSurfaceIdentityPresentation(
            Transform surfaceRoot,
            CertifiedDungeonSurfaceGeometryV2 surface,
            Material material)
        {
            Bounds bounds = ToUnityBounds(surface.Volume);
            Vector3 size = bounds.size;
            Vector3 localTop = surface.ColliderKind == CertifiedDungeonColliderKindV2.Box
                ? new Vector3(0f, size.y * 0.5f + 0.018f, 0f)
                : new Vector3(bounds.center.x, bounds.max.y + 0.018f, bounds.center.z);
            if (surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
            {
                CreateBoxProp(surfaceRoot, "MovingPlatformTravelChevron", localTop,
                    new Vector3(Mathf.Max(0.4f, size.x * 0.55f), 0.035f, 0.14f), material,
                    Quaternion.Euler(0f, 28f, 0f));
                CreateCylinderProp(surfaceRoot, "MovingPlatformDriveHub",
                    localTop + Vector3.down * Mathf.Max(0.12f, size.y * 0.75f),
                    Mathf.Min(0.55f, Mathf.Min(size.x, size.z) * 0.22f),
                    0.18f,
                    material,
                    Quaternion.Euler(90f, 0f, 0f));
            }
            else if (surface.Kind == DungeonSurfaceKindV2.Hazard)
            {
                float insetX = Mathf.Max(0.1f, size.x * 0.42f);
                float insetZ = Mathf.Max(0.1f, size.z * 0.42f);
                CreateBoxProp(surfaceRoot, "HazardWarningNorth", localTop + Vector3.forward * insetZ,
                    new Vector3(Mathf.Max(0.4f, size.x * 0.82f), 0.04f, 0.12f), material);
                CreateBoxProp(surfaceRoot, "HazardWarningSouth", localTop + Vector3.back * insetZ,
                    new Vector3(Mathf.Max(0.4f, size.x * 0.82f), 0.04f, 0.12f), material);
                CreateBoxProp(surfaceRoot, "HazardWarningWest", localTop + Vector3.left * insetX,
                    new Vector3(0.12f, 0.04f, Mathf.Max(0.4f, size.z * 0.82f)), material);
                CreateBoxProp(surfaceRoot, "HazardWarningEast", localTop + Vector3.right * insetX,
                    new Vector3(0.12f, 0.04f, Mathf.Max(0.4f, size.z * 0.82f)), material);
            }
            else if (surface.Kind == DungeonSurfaceKindV2.DoorSweep)
            {
                CreateBoxProp(surfaceRoot, "AuthoredGateFace", Vector3.zero,
                    new Vector3(
                        Mathf.Max(0.18f, size.x * 0.88f),
                        Mathf.Max(0.18f, size.y * 0.88f),
                        Mathf.Max(0.08f, size.z * 0.16f)),
                    material);
            }
            else if (surface.MaterialProfileId.IndexOf(
                "crumble",
                StringComparison.OrdinalIgnoreCase) >= 0)
            {
                CreateBoxProp(surfaceRoot, "CrumbleFractureA", localTop,
                    new Vector3(Mathf.Max(0.4f, size.x * 0.72f), 0.025f, 0.07f),
                    material,
                    Quaternion.Euler(0f, 24f, 0f));
                CreateBoxProp(surfaceRoot, "CrumbleFractureB", localTop,
                    new Vector3(Mathf.Max(0.4f, size.x * 0.52f), 0.025f, 0.07f),
                    material,
                    Quaternion.Euler(0f, -37f, 0f));
            }
        }

        private static GameObject CreateAnchor(
            Transform parent,
            CertifiedDungeonAnchorGeometryV2 anchor)
        {
            GameObject item = Empty(parent, "Anchor_" + anchor.Id);
            item.transform.localPosition = ToUnity(anchor.Position);
            item.AddComponent<DungeonAnchorGeometryAuthoringV2>().Configure(
                anchor.Id,
                anchor.RegionId,
                anchor.Kind,
                anchor.ProfileId);
            return item;
        }

        private static GameObject CreateAnchorPresentation(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform presentationRoot,
            CertifiedDungeonAnchorGeometryV2 anchor,
            MaterialSet materials)
        {
            GameObject target = Empty(
                presentationRoot,
                "AnchorTarget_" + anchor.Kind + "_" + anchor.RegionId + "_" + anchor.Id);
            target.transform.localPosition = ToUnity(anchor.Position);

            CertifiedDungeonRegionGeometryV2 region = definition.CertifiedGeometry.Regions
                .FirstOrDefault(value => string.Equals(value.Id, anchor.RegionId, StringComparison.Ordinal));
            DungeonBiomeDistrictKindV2 district = region != null
                ? region.DistrictKind
                : DungeonBiomeDistrictKindV2.Factory;
            Material body = materials.ResolveDistrictBody(district);
            Material accent = materials.ResolveDistrictAccent(district);

            switch (anchor.Kind)
            {
                case DungeonAnchorKindV2.Console:
                    BuildAnchorConsole(target.transform, anchor, body, accent);
                    break;
                case DungeonAnchorKindV2.Landmark:
                case DungeonAnchorKindV2.Reveal:
                    BuildAnchorLandmark(target.transform, anchor, district, body, accent, materials);
                    break;
                case DungeonAnchorKindV2.Reward:
                    BuildAnchorReward(target.transform, anchor, body, accent, materials);
                    break;
                case DungeonAnchorKindV2.ShortcutActivation:
                    BuildAnchorShortcut(target.transform, anchor, body, accent);
                    break;
                case DungeonAnchorKindV2.Extraction:
                    BuildAnchorExtraction(target.transform, anchor, body, accent);
                    break;
                case DungeonAnchorKindV2.Safe:
                    BuildAnchorSafePad(target.transform, anchor, body, accent);
                    break;
                default:
                    // Entry, exit, encounter, and spawn anchors are intentionally
                    // non-visual, but their runtime target still lives under the
                    // Presentation hierarchy. Certification markers remain pure,
                    // invisible geometry metadata and are never runtime targets.
                    break;
            }

            return target;
        }

        private static void BuildAnchorConsole(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            Material body,
            Material accent)
        {
            CreateBoxProp(target, "ConsolePedestal", new Vector3(0f, 0.6f, 0f),
                new Vector3(1.45f, 1.2f, 0.9f), body);
            CreateBoxProp(target, "ConsoleScreen", new Vector3(0f, 1.18f, 0.32f),
                new Vector3(1.08f, 0.62f, 0.08f), accent, Quaternion.Euler(-14f, 0f, 0f));
            for (int index = -1; index <= 1; index += 1)
                CreateCylinderProp(target, "ConsoleControl_" + index,
                    new Vector3(index * 0.28f, 0.92f, 0.53f), 0.08f, 0.05f, accent,
                    Quaternion.Euler(90f, 0f, 0f));
            AddAuthoredPrompt(target, "INTERACT // " + Humanize(anchor.ProfileId));
        }

        private static void BuildAnchorLandmark(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            DungeonBiomeDistrictKindV2 district,
            Material body,
            Material accent,
            MaterialSet materials)
        {
            CreateBoxProp(target, "LandmarkPlinth", new Vector3(0f, 0.28f, 0f),
                new Vector3(1.65f, 0.56f, 1.65f), body);
            switch (district)
            {
                case DungeonBiomeDistrictKindV2.Waterworks:
                    CreateCylinderProp(target, "WaterPressureColumn", new Vector3(0f, 1.55f, 0f),
                        0.48f, 2.55f, materials.WaterworksPipes);
                    CreateCylinderProp(target, "WaterworksValveLandmark", new Vector3(0f, 1.55f, 0.5f),
                        0.78f, 0.10f, accent, Quaternion.Euler(90f, 0f, 0f));
                    break;
                case DungeonBiomeDistrictKindV2.MagmaUndercroft:
                    CreateBoxProp(target, "FurnaceLandmark", new Vector3(0f, 1.2f, 0f),
                        new Vector3(1.6f, 2.4f, 1.35f), materials.MagmaWall);
                    CreateBoxProp(target, "FurnaceSightGlass", new Vector3(0f, 1.25f, 0.69f),
                        new Vector3(0.8f, 1.05f, 0.05f), materials.MagmaSurface);
                    break;
                case DungeonBiomeDistrictKindV2.ElectricalUndercroft:
                    CreateBoxProp(target, "TransformerLandmark", new Vector3(0f, 1.25f, 0f),
                        new Vector3(1.55f, 2.5f, 1.25f), materials.ElectricalWall);
                    for (int side = -1; side <= 1; side += 2)
                        CreateCylinderProp(target, "TransformerCoil_" + side,
                            new Vector3(side * 0.45f, 1.6f, 0.68f), 0.2f, 0.95f,
                            materials.ElectricalLive);
                    break;
                default:
                    CreateBoxProp(target, "FactoryDatumPylon", new Vector3(0f, 1.35f, 0f),
                        new Vector3(0.72f, 2.7f, 0.72f), body);
                    CreateCylinderProp(target, "FactoryDatumRotor", new Vector3(0f, 2.35f, 0f),
                        0.62f, 0.12f, accent);
                    break;
            }
            AddAuthoredLabel(target, "LANDMARK // " + Humanize(anchor.ProfileId), 3.15f);
        }

        private static void BuildAnchorReward(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            Material body,
            Material accent,
            MaterialSet materials)
        {
            CreateCylinderProp(target, "RewardPedestal", new Vector3(0f, 0.24f, 0f),
                0.82f, 0.48f, body);
            if (string.Equals(
                anchor.ProfileId,
                LargeRefractorRewardProfileId,
                StringComparison.Ordinal))
            {
                GameObject pickup = Empty(target, "LargeRefractorPickupV2");
                pickup.transform.localPosition = Vector3.up * 0.65f;
                GameObject visual = CreateDirectPrimitiveWithoutCollider(
                    PrimitiveType.Cube,
                    pickup.transform,
                    "RefractorVisual",
                    new Vector3(0f, 0.15f, 0f),
                    new Vector3(0.42f, 0.65f, 0.42f),
                    Quaternion.Euler(45f, 45f, 0f),
                    materials.WaterworksSurface);
                CreateBoxProp(visual.transform, "RefractorCore", Vector3.zero,
                    new Vector3(0.34f, 0.34f, 0.34f), accent,
                    Quaternion.Euler(0f, 45f, 0f));
                AddAuthoredLabel(pickup.transform, "LARGE REFRACTOR", 1.05f, "RefractorLabel");
            }
            else
            {
                GameObject cache = CreateCrate(target, "CuratedRecoveryCache",
                    new Vector3(0f, 0.78f, 0f), 0.9f, materials);
                CreateBoxProp(cache.transform, "RecoveryBeacon", new Vector3(0f, 0.62f, 0f),
                    new Vector3(0.18f, 0.42f, 0.18f), accent);
            }
            AddAuthoredPrompt(target, "RECOVER // " + Humanize(anchor.ProfileId));
        }

        private static void BuildAnchorShortcut(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            Material body,
            Material accent)
        {
            CreateBoxProp(target, "ShortcutHousing", new Vector3(0f, 0.8f, 0f),
                new Vector3(1.2f, 1.6f, 0.75f), body);
            CreateBoxProp(target, "ShortcutLever", new Vector3(0f, 1.25f, 0.48f),
                new Vector3(0.18f, 0.7f, 0.18f), accent, Quaternion.Euler(-28f, 0f, 0f));
            AddAuthoredPrompt(target, "ACTIVATE SHORTCUT // " + Humanize(anchor.ProfileId));
        }

        private static void BuildAnchorExtraction(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            Material body,
            Material accent)
        {
            for (int side = -1; side <= 1; side += 2)
                CreateBoxProp(target, "ExtractionPillar_" + side,
                    new Vector3(side * 1.1f, 1.45f, 0f), new Vector3(0.36f, 2.9f, 0.5f), body);
            CreateBoxProp(target, "ExtractionLintel", new Vector3(0f, 2.75f, 0f),
                new Vector3(2.55f, 0.35f, 0.5f), body);
            CreateBoxProp(target, "ExtractionBeacon", new Vector3(0f, 2.75f, 0.28f),
                new Vector3(1.25f, 0.12f, 0.06f), accent);
            AddAuthoredPrompt(target, "EXTRACT // " + Humanize(anchor.ProfileId));
        }

        private static void BuildAnchorSafePad(
            Transform target,
            CertifiedDungeonAnchorGeometryV2 anchor,
            Material body,
            Material accent)
        {
            CreateCylinderProp(target, "SafeReturnPad", new Vector3(0f, 0.035f, 0f),
                0.86f, 0.07f, body);
            CreateBoxProp(target, "SafeCrossHorizontal", new Vector3(0f, 0.095f, 0f),
                new Vector3(0.78f, 0.025f, 0.18f), accent);
            CreateBoxProp(target, "SafeCrossVertical", new Vector3(0f, 0.095f, 0f),
                new Vector3(0.18f, 0.025f, 0.78f), accent);
            AddAuthoredLabel(target, "SAFE RETURN // " + Humanize(anchor.ProfileId), 0.72f);
        }

        private static void CreateConnector(
            Transform parent,
            CertifiedDungeonConnectorGeometryV2 connector,
            GameObject capPrefab)
        {
            GameObject item = Empty(parent, "Connector_" + connector.Id);
            item.transform.localPosition = ToUnity(connector.Position);
            Vector3 facing = ToUnityDirection(connector.Facing).normalized;
            item.transform.localRotation = Quaternion.LookRotation(facing, Vector3.up);
            var marker = item.AddComponent<DungeonConnectorGeometryAuthoringV2>();
            marker.Configure(connector.Id, connector.RegionId, connector.Kind, connector.SocketTag);

            DungeonConnectorApertureV2 aperture = connector.Aperture;
            LocalBox apertureBox = ToLocalBox(item.transform, aperture.LocalVolume);
            LocalBox player = ToLocalBox(item.transform, aperture.PlayerClearanceVolume);
            LocalBox camera = ToLocalBox(item.transform, aperture.CameraClearanceVolume);
            LocalBox approach = ToLocalBox(item.transform, aperture.ApproachVolume);
            marker.ConfigureAperture(
                apertureBox.Center,
                apertureBox.Size,
                aperture.CompatibleConnectorKinds,
                aperture.ThemedCapProfileId);
            marker.ConfigureCertification(
                (float)(aperture.FloorElevation - connector.Position.Y),
                (float)aperture.FloorSlopeDegrees,
                player.Center,
                player.Size,
                camera.Center,
                camera.Size,
                (float)aperture.SeamDepth,
                approach.Center,
                approach.Size,
                aperture.NavigationHandoffProfileId,
                aperture.CapState,
                capPrefab,
                aperture.MechanismBindingId,
                aperture.ExteriorGasketProfileId,
                aperture.VerticalCompositionPortalId);
        }

        private static void CreateRuntimeBinding(
            Transform parent,
            string stableId,
            string regionId,
            DungeonRuntimeBindingKindV2 kind,
            GameObject target,
            string profileId)
        {
            GameObject item = Empty(parent, "Binding_" + kind + "_" + stableId);
            item.transform.position = target.transform.position;
            item.AddComponent<DungeonRuntimeBindingAuthoringV2>().Configure(
                stableId, regionId, kind, target, profileId);
        }

        private static void CreateFluidBindingIfNeeded(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform presentationRoot,
            Transform bindingsRoot,
            IReadOnlyDictionary<string, GameObject> presentationSurfaces,
            MaterialSet materials)
        {
            CertifiedDungeonRegionGeometryV2 waterRegion = definition.CertifiedGeometry.Regions
                .FirstOrDefault(value => value.DistrictKind == DungeonBiomeDistrictKindV2.Waterworks);
            if (waterRegion == null) return;
            CertifiedDungeonSurfaceGeometryV2 bed = definition.CertifiedGeometry.Surfaces.FirstOrDefault(value =>
                value.RegionId == waterRegion.Id && value.Kind == DungeonSurfaceKindV2.WaterBed);
            if (bed == null || !presentationSurfaces.TryGetValue(bed.Id, out GameObject bedObject)) return;

            Bounds bounds = ToUnityBounds(bed.Volume);
            GameObject surface = CreatePrimitiveWithoutCollider(
                PrimitiveType.Cube,
                presentationRoot,
                "WaterSurface_" + waterRegion.Id,
                new Vector3(bounds.center.x, bounds.max.y + 2.8f, bounds.center.z),
                new Vector3(Mathf.Max(1f, bounds.size.x - 0.5f), 0.08f,
                    Mathf.Max(1f, bounds.size.z - 0.5f)),
                Quaternion.identity,
                materials.WaterworksSurface);
            CreateRuntimeBinding(
                bindingsRoot,
                "fluid-surface-" + waterRegion.Id,
                waterRegion.Id,
                DungeonRuntimeBindingKindV2.FluidSurface,
                surface,
                IndustrialFactoryV2Ruleset.WaterNetworkId);
        }

        private static void CreateKeySeekerBindingIfNeeded(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform presentationRoot,
            Transform bindingsRoot,
            MaterialSet materials)
        {
            if (!definition.CompatibleMacroRoles.Contains(DungeonMacroRoleKindV2.SecurityEntrance)) return;
            CertifiedDungeonRegionGeometryV2 entry = definition.CertifiedGeometry.Regions
                .First(value => value.Id == IndustrialFactoryV2ModuleCatalog.LocalRegionId);
            Bounds bounds = ToUnityBounds(new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(entry.Bounds.Minimum.X, entry.Bounds.Minimum.Z),
                    new DungeonPoint2V2(entry.Bounds.Maximum.X, entry.Bounds.Minimum.Z),
                    new DungeonPoint2V2(entry.Bounds.Maximum.X, entry.Bounds.Maximum.Z),
                    new DungeonPoint2V2(entry.Bounds.Minimum.X, entry.Bounds.Maximum.Z)
                }, entry.Bounds.Minimum.Y, entry.Bounds.Maximum.Y));
            GameObject seeker = CreateConsole(
                presentationRoot,
                "KeySeekerTerminal",
                new Vector3(bounds.min.x + 2.2f, bounds.min.y + 1f, bounds.min.z + 2.2f),
                materials.FactoryWall,
                materials.FactoryConduit);
            CreateBoxProp(seeker.transform, "KeySeekerDish", new Vector3(0f, 1.2f, 0f),
                new Vector3(1.25f, 0.16f, 1.25f), materials.FactoryConduit,
                Quaternion.Euler(12f, 0f, 0f));
            AddAuthoredPrompt(seeker.transform, "ACTIVATE KEY SEEKER");
            CreateRuntimeBinding(
                bindingsRoot,
                "key-seeker",
                entry.Id,
                DungeonRuntimeBindingKindV2.Mechanism,
                seeker,
                "key-seeker-v2");
        }

        private static Mesh CreateRampMesh(CertifiedDungeonSurfaceGeometryV2 surface)
        {
            CertifiedDungeonRampWedgeV2 ramp = surface.RampWedge;
            Bounds bounds = ToUnityBounds(ramp.BoundingVolume);
            Vector3 rise = ToUnityDirection(ramp.RiseDirection).normalized;
            rise.y = 0f;
            Vector3 across = Vector3.Cross(Vector3.up, rise).normalized;
            float length = Mathf.Abs(rise.x) > 0.5f ? bounds.size.x : bounds.size.z;
            float width = Mathf.Abs(across.x) > 0.5f ? bounds.size.x : bounds.size.z;
            Vector3 horizontalCenter = new Vector3(bounds.center.x, 0f, bounds.center.z);
            Vector3 lowCenter = horizontalCenter - rise * (length * 0.5f);
            Vector3 highCenter = horizontalCenter + rise * (length * 0.5f);
            float bottom = bounds.min.y;
            float high = (float)ramp.HighSurfaceY;
            Vector3 lowLeft = lowCenter - across * (width * 0.5f) + Vector3.up * bottom;
            Vector3 lowRight = lowCenter + across * (width * 0.5f) + Vector3.up * bottom;
            Vector3 highLeftBottom = highCenter - across * (width * 0.5f) + Vector3.up * bottom;
            Vector3 highRightBottom = highCenter + across * (width * 0.5f) + Vector3.up * bottom;
            Vector3 highLeftTop = highCenter - across * (width * 0.5f) + Vector3.up * high;
            Vector3 highRightTop = highCenter + across * (width * 0.5f) + Vector3.up * high;

            Vector3[] vertices =
            {
                lowLeft, lowRight, highLeftBottom, highRightBottom, highLeftTop, highRightTop
            };
            var triangles = new List<int>(30);
            Vector3 solidCenter = bounds.center;
            AddFace(triangles, vertices, solidCenter, 0, 2, 3);
            AddFace(triangles, vertices, solidCenter, 0, 3, 1);
            AddFace(triangles, vertices, solidCenter, 0, 1, 5);
            AddFace(triangles, vertices, solidCenter, 0, 5, 4);
            AddFace(triangles, vertices, solidCenter, 0, 4, 2);
            AddFace(triangles, vertices, solidCenter, 1, 3, 5);
            AddFace(triangles, vertices, solidCenter, 2, 4, 5);
            AddFace(triangles, vertices, solidCenter, 2, 5, 3);
            return FinalizeMesh(surface.Id + "_wedge", vertices, triangles.ToArray());
        }

        private static Mesh CreatePrismMesh(DungeonConvexPrismV2 prism, string name)
        {
            int count = prism.HorizontalVertices.Count;
            var vertices = new Vector3[count * 2];
            for (int index = 0; index < count; index += 1)
            {
                DungeonPoint2V2 point = prism.HorizontalVertices[index];
                vertices[index] = new Vector3(-(float)point.X, (float)prism.MinimumY, (float)point.Z);
                vertices[index + count] = new Vector3(-(float)point.X, (float)prism.MaximumY, (float)point.Z);
            }
            var triangles = new List<int>(count * 12);
            Vector3 center = vertices.Aggregate(Vector3.zero, (sum, value) => sum + value) / vertices.Length;
            for (int index = 1; index < count - 1; index += 1)
            {
                AddFace(triangles, vertices, center, 0, index + 1, index);
                AddFace(triangles, vertices, center, count, count + index, count + index + 1);
            }
            for (int index = 0; index < count; index += 1)
            {
                int next = (index + 1) % count;
                AddFace(triangles, vertices, center, index, next, next + count);
                AddFace(triangles, vertices, center, index, next + count, index + count);
            }
            return FinalizeMesh(name + "_prism", vertices, triangles.ToArray());
        }

        private static void AddFace(
            ICollection<int> destination,
            IReadOnlyList<Vector3> vertices,
            Vector3 solidCenter,
            int a,
            int b,
            int c)
        {
            Vector3 faceCenter = (vertices[a] + vertices[b] + vertices[c]) / 3f;
            Vector3 normal = Vector3.Cross(vertices[b] - vertices[a], vertices[c] - vertices[a]);
            if (Vector3.Dot(normal, faceCenter - solidCenter) < 0f) (b, c) = (c, b);
            destination.Add(a);
            destination.Add(b);
            destination.Add(c);
        }

        private static Mesh FinalizeMesh(string name, Vector3[] vertices, int[] triangles)
        {
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            var uv = new Vector2[vertices.Length];
            for (int index = 0; index < vertices.Length; index += 1)
                uv[index] = new Vector2(vertices[index].x, vertices[index].z) * 0.2f;
            mesh.uv = uv;
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static GameObject CreateFamilyPresentation(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform parent,
            IReadOnlyDictionary<string, GameObject> presentationSurfaces,
            ModuleSpace space,
            MaterialSet materials)
        {
            GameObject family = Empty(parent, "Authored_" + definition.Composition.Archetype);
            family.AddComponent<DungeonPropProfileAuthoringV2>().Configure(definition.Composition.PropProfile);
            bool variantB = definition.VariantId == IndustrialFactoryV2ModuleCatalog.VariantB;
            CertifiedDungeonSurfaceGeometryV2[] occupancies = definition.CertifiedGeometry.Surfaces
                .Where(value => value.Kind == DungeonSurfaceKindV2.SolidOccupancy
                    && value.MaterialProfileId.StartsWith("machinery-", StringComparison.Ordinal))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            if (occupancies.Length == 0)
            {
                throw new InvalidOperationException(definition.TemplateId
                    + " has no certified machinery SolidOccupancy surfaces. Primary family props may not be free-standing decoration.");
            }

            // The textured occupancy renderers are the exact visual proxy for
            // certified collision. Family-specific machinery is relief/detail
            // authored on those footprints, never an independent solid placed
            // into the navigation volume.
            foreach (CertifiedDungeonSurfaceGeometryV2 occupancy in occupancies)
            {
                if (!presentationSurfaces.TryGetValue(occupancy.Id, out GameObject target)
                    || target == null)
                {
                    throw new InvalidOperationException(definition.TemplateId
                        + " has no exact presentation binding for machinery occupancy "
                        + occupancy.Id + ".");
                }
                target.name = "CertifiedMachineBase_" + occupancy.Id;
                AddCertifiedMachineBaseTrim(
                    family.transform,
                    occupancy,
                    materials.ResolveMachineryAccent(definition, occupancy),
                    variantB);
            }

            IReadOnlyList<DungeonModuleSemanticFeatureV2> features =
                definition.Composition.RequiredSemanticFeatures;
            for (int index = 0; index < features.Count; index += 1)
            {
                CertifiedDungeonSurfaceGeometryV2 occupancy = occupancies[index % occupancies.Length];
                Transform group = FeatureGroup(family.transform, features[index]);
                BuildCertifiedFeatureDetail(
                    group,
                    features[index],
                    occupancy,
                    materials.ResolveMachineryAccent(definition, occupancy),
                    materials,
                    variantB);
            }

            DungeonModuleSemanticFeatureV2[] declared = family
                .GetComponentsInChildren<DungeonSemanticFeatureAuthoringV2>(true)
                .Select(value => value.Feature).Distinct().ToArray();
            foreach (DungeonModuleSemanticFeatureV2 feature in definition.Composition.RequiredSemanticFeatures)
            {
                if (!declared.Contains(feature))
                    throw new InvalidOperationException(definition.TemplateId
                        + " family composition forgot real presentation for semantic feature " + feature + ".");
            }
            return family;
        }

        private static void AddCertifiedMachineBaseTrim(
            Transform parent,
            CertifiedDungeonSurfaceGeometryV2 occupancy,
            Material accent,
            bool variantB)
        {
            Bounds bounds = ToUnityBounds(occupancy.Volume);
            Transform group = Child(parent, "CertifiedMachineRelief_" + occupancy.Id);
            float faceZ = variantB ? bounds.min.z - 0.035f : bounds.max.z + 0.035f;
            for (int band = -1; band <= 1; band += 1)
            {
                CreateBoxProp(group, "MachineServiceBand_" + band,
                    new Vector3(bounds.center.x,
                        bounds.center.y + band * bounds.size.y * 0.28f,
                        faceZ),
                    new Vector3(Mathf.Max(0.35f, bounds.size.x * 0.82f),
                        Mathf.Max(0.08f, bounds.size.y * 0.055f), 0.07f),
                    accent);
            }
            for (int side = -1; side <= 1; side += 2)
            {
                CreateCylinderProp(group, "MachineDatumBolt_" + side,
                    new Vector3(bounds.center.x + side * bounds.size.x * 0.36f,
                        bounds.center.y, faceZ + (variantB ? -0.02f : 0.02f)),
                    Mathf.Clamp(Mathf.Min(bounds.size.x, bounds.size.y) * 0.055f, 0.07f, 0.22f),
                    0.08f,
                    accent,
                    Quaternion.Euler(90f, 0f, 0f));
            }
        }

        private static void BuildCertifiedFeatureDetail(
            Transform group,
            DungeonModuleSemanticFeatureV2 feature,
            CertifiedDungeonSurfaceGeometryV2 occupancy,
            Material accent,
            MaterialSet materials,
            bool variantB)
        {
            Bounds bounds = ToUnityBounds(occupancy.Volume);
            float faceZ = variantB ? bounds.min.z - 0.075f : bounds.max.z + 0.075f;
            Vector3 faceCenter = new Vector3(bounds.center.x, bounds.center.y, faceZ);
            float featureRadius = Mathf.Clamp(Mathf.Min(bounds.size.x, bounds.size.y) * 0.22f,
                0.28f, 1.15f);

            switch (feature)
            {
                case DungeonModuleSemanticFeatureV2.Valves:
                case DungeonModuleSemanticFeatureV2.Pumps:
                case DungeonModuleSemanticFeatureV2.Turbines:
                case DungeonModuleSemanticFeatureV2.LiftMachinery:
                case DungeonModuleSemanticFeatureV2.FurnaceInfrastructure:
                case DungeonModuleSemanticFeatureV2.TransformerInfrastructure:
                    CreateCylinderProp(group, "CertifiedFaceRotor_" + feature, faceCenter,
                        featureRadius, 0.16f, accent, Quaternion.Euler(90f, 0f, 0f));
                    for (int spoke = 0; spoke < 4; spoke += 1)
                        CreateBoxProp(group, "CertifiedRotorSpoke_" + spoke,
                            faceCenter + Quaternion.Euler(0f, 0f, spoke * 90f)
                                * new Vector3(featureRadius * 0.42f, 0f, 0f),
                            new Vector3(featureRadius * 1.35f, 0.09f, 0.08f), accent,
                            Quaternion.Euler(0f, 0f, spoke * 90f));
                    break;

                case DungeonModuleSemanticFeatureV2.ServerBanks:
                case DungeonModuleSemanticFeatureV2.RechargePods:
                case DungeonModuleSemanticFeatureV2.SecurityBulkheads:
                case DungeonModuleSemanticFeatureV2.StorageRacks:
                case DungeonModuleSemanticFeatureV2.SurveillanceDisplays:
                case DungeonModuleSemanticFeatureV2.CredentialConsole:
                    for (int panel = -1; panel <= 1; panel += 1)
                        CreateBoxProp(group, "CertifiedServicePanel_" + feature + "_" + panel,
                            new Vector3(bounds.center.x,
                                bounds.center.y + panel * bounds.size.y * 0.27f,
                                faceZ),
                            new Vector3(Mathf.Max(0.45f, bounds.size.x * 0.68f),
                                Mathf.Max(0.18f, bounds.size.y * 0.18f), 0.09f),
                            panel == 0 ? materials.ElectricalLive : accent);
                    break;

                case DungeonModuleSemanticFeatureV2.RobotArms:
                case DungeonModuleSemanticFeatureV2.CargoCrane:
                case DungeonModuleSemanticFeatureV2.MaintenanceScaffolds:
                case DungeonModuleSemanticFeatureV2.ReactorSupports:
                    Vector3 basePoint = new Vector3(bounds.center.x, bounds.max.y, bounds.center.z);
                    Vector3 elbow = basePoint + new Vector3(
                        variantB ? bounds.size.x * 0.24f : 0f,
                        Mathf.Clamp(bounds.size.y * 0.28f, 0.6f, 1.4f),
                        variantB ? 0f : bounds.size.z * 0.24f);
                    CreatePipe(group, "CertifiedLoadArmA_" + feature, basePoint, elbow,
                        0.16f, accent);
                    CreatePipe(group, "CertifiedLoadArmB_" + feature, elbow,
                        elbow + Vector3.up * 0.65f, 0.13f, accent);
                    break;

                default:
                    CreateBoxProp(group, "CertifiedTopMechanism_" + feature,
                        new Vector3(bounds.center.x, bounds.max.y + 0.12f, bounds.center.z),
                        new Vector3(Mathf.Max(0.45f, bounds.size.x * 0.58f), 0.22f,
                            Mathf.Max(0.45f, bounds.size.z * 0.58f)), accent);
                    CreatePipe(group, "CertifiedServiceConduit_" + feature,
                        new Vector3(bounds.min.x + bounds.size.x * 0.18f, bounds.max.y,
                            bounds.center.z),
                        new Vector3(bounds.max.x - bounds.size.x * 0.18f, bounds.max.y + 0.35f,
                            bounds.center.z),
                        0.1f, accent);
                    break;
            }
        }

        private static IReadOnlyList<DungeonStructuralSupportAuthoringV2> CreateStructuralSupports(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform parent,
            ModuleSpace space,
            MaterialSet materials)
        {
            Transform group = Child(parent, "VisibleStructuralSupports");
            var result = new List<DungeonStructuralSupportAuthoringV2>();
            int index = 0;
            foreach (DungeonStructuralSupportKindV2 kind in definition.Composition.RequiredSupports)
            {
                float side = index % 2 == 0 ? -1f : 1f;
                Vector3 position = new Vector3(
                    space.EntryCenter.x + side * Mathf.Min(4.5f, space.EntrySize.x * 0.28f),
                    space.EntryFloor + 2f,
                    space.EntryCenter.z + (index < 2 ? 0f : 3f));
                GameObject support;
                switch (kind)
                {
                    case DungeonStructuralSupportKindV2.Column:
                        support = CreateBoxProp(group, "LoadBearingColumn", position,
                            new Vector3(0.65f, 4f, 0.65f), materials.FactoryWall);
                        break;
                    case DungeonStructuralSupportKindV2.Truss:
                    case DungeonStructuralSupportKindV2.Girder:
                        support = CreateBoxProp(group, kind.ToString(),
                            new Vector3(space.EntryCenter.x, space.EntryFloor + 4.2f,
                                space.EntryCenter.z + side * 2f),
                            new Vector3(Mathf.Min(9f, space.EntrySize.x * 0.5f), 0.45f, 0.45f),
                            materials.FactoryCatwalk,
                            variantRotation: Quaternion.Euler(0f, index * 90f, 0f));
                        break;
                    case DungeonStructuralSupportKindV2.Suspension:
                        support = CreatePipe(group, "SuspensionRod",
                            new Vector3(position.x, space.EntryFloor + 3f, position.z),
                            new Vector3(position.x, space.EntryCeiling - 0.5f, position.z),
                            0.12f, materials.FactoryConduit);
                        break;
                    case DungeonStructuralSupportKindV2.Bracket:
                        support = CreateBoxProp(group, "WallBracket", position,
                            new Vector3(1.5f, 0.35f, 1f), materials.FactoryCatwalk,
                            Quaternion.Euler(0f, 0f, side * 25f));
                        break;
                    default:
                        support = CreateBoxProp(group, "MachineryFrame", position,
                            new Vector3(2f, 3.5f, 0.6f), materials.FactoryWall);
                        CreateBoxProp(support.transform, "FrameCrossbar", new Vector3(0f, 0.8f, 0f),
                            new Vector3(2.8f, 0.35f, 0.8f), materials.FactoryCatwalk);
                        break;
                }
                var marker = support.AddComponent<DungeonStructuralSupportAuthoringV2>();
                marker.Configure("support-" + kind.ToString().ToLowerInvariant(), kind);
                result.Add(marker);
                index += 1;
            }
            return result;
        }

        private static void CreatePlatformPurposeMarkers(
            DungeonModuleCompositionContractV2 contract,
            Transform parent,
            IReadOnlyDictionary<string, DungeonSurfaceGeometryAuthoringV2> certified,
            IReadOnlyList<DungeonStructuralSupportAuthoringV2> supports)
        {
            Transform group = Child(parent, "PlatformPurposeDeclarations");
            foreach (DungeonPlatformPurposeBindingV2 binding in contract.PlatformPurposes)
            {
                DungeonSurfaceGeometryAuthoringV2 target = SelectPlatformSurface(binding.Purpose, certified.Values);
                GameObject item = Empty(group, "Purpose_" + binding.PlatformId);
                item.AddComponent<DungeonPlatformPurposeAuthoringV2>().Configure(
                    binding.PlatformId,
                    binding.Purpose,
                    binding.TargetId,
                    target,
                    supports);
            }
        }

        private static DungeonSurfaceGeometryAuthoringV2 SelectPlatformSurface(
            DungeonPlatformPurposeV2 purpose,
            IEnumerable<DungeonSurfaceGeometryAuthoringV2> surfaces)
        {
            DungeonSurfaceGeometryAuthoringV2[] candidates = surfaces.ToArray();
            bool observation = purpose == DungeonPlatformPurposeV2.ObservationOnly;
            if (observation)
            {
                return candidates.FirstOrDefault(value => !value.IsWalkable)
                    ?? throw new InvalidOperationException("ObservationOnly needs a certified non-walkable surface.");
            }
            string[] preferred = purpose switch
            {
                DungeonPlatformPurposeV2.OptionalReward => new[] { "reward-platform", "upper-platform", "supported-catwalk" },
                DungeonPlatformPurposeV2.RecoveryCatchment => new[] { "lower-floor", "entry-floor" },
                DungeonPlatformPurposeV2.CombatFlank => new[] { "upper-platform", "supported-catwalk", "entry-floor" },
                DungeonPlatformPurposeV2.MechanismStaging => new[] { "entry-floor", "upper-platform" },
                _ => new[] { "upper-platform", "supported-catwalk", "entry-floor", "lower-floor" }
            };
            foreach (string id in preferred)
            {
                DungeonSurfaceGeometryAuthoringV2 match = candidates.FirstOrDefault(value =>
                    value.IsWalkable
                    && (string.Equals(value.StableId, id, StringComparison.Ordinal)
                        || value.StableId.StartsWith(id + "-", StringComparison.Ordinal)));
                if (match != null) return match;
            }
            return candidates.First(value => value.IsWalkable);
        }

        private static void CreateMechanismStoryLightingAndProfile(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform presentationRoot,
            Transform familyRoot,
            ModuleSpace space,
            MaterialSet materials)
        {
            int mechanismIndex = 0;
            foreach (DungeonMechanismProfileV2 profile in definition.Composition.MechanismProfiles)
            {
                if (profile == DungeonMechanismProfileV2.None) continue;
                Vector3 position = new Vector3(
                    space.EntryCenter.x + (mechanismIndex - 0.5f) * 2.5f,
                    space.EntryFloor + 1f,
                    space.EntryCenter.z - Mathf.Min(4f, space.EntrySize.z * 0.3f));
                GameObject console = CreateConsole(familyRoot, "Mechanism_" + profile,
                    position, materials.FactoryWall,
                    definition.Composition.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom
                        ? (definition.VariantId == IndustrialFactoryV2ModuleCatalog.VariantB
                            ? materials.ElectricalLive : materials.MagmaSurface)
                        : materials.FactoryConduit);
                console.AddComponent<DungeonMechanismAuthoringV2>().Configure(
                    "mechanism-" + profile.ToString().ToLowerInvariant(), profile);
                mechanismIndex += 1;
            }

            GameObject story = CreateBoxProp(familyRoot, "StoryVignette_" + definition.Composition.StoryVignette,
                new Vector3(space.EntryCenter.x, space.EntryFloor + 0.12f,
                    space.EntryCenter.z + Mathf.Min(5f, space.EntrySize.z * 0.32f)),
                new Vector3(3.5f, 0.2f, 2.2f),
                definition.Composition.Archetype == DungeonModuleArchetypeV2.HazardProcessingRoom
                    ? materials.MagmaCrust : materials.FactoryFloor);
            story.AddComponent<DungeonStoryVignetteAuthoringV2>()
                .Configure(definition.Composition.StoryVignette);

            int rigIndex = 0;
            foreach (DungeonLightingProfileV2 profile in definition.Composition.LightingProfiles)
            {
                CreateLightingRig(presentationRoot, space, profile, rigIndex,
                    definition.Composition.LightingProfiles.Count, materials,
                    shadowed: rigIndex == 0);
                rigIndex += 1;
            }
        }

        private static void BuildAncientServerCrypt(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform banks = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.ServerBanks);
            int count = variantB ? 6 : 8;
            for (int index = 0; index < count; index += 1)
            {
                float lane = index % 2 == 0 ? -1f : 1f;
                float along = (index / 2 - (count / 4f - 0.5f)) * 3.2f;
                Vector3 position = variantB
                    ? new Vector3(space.EntryCenter.x + along, space.EntryFloor + 1.8f,
                        space.EntryCenter.z + lane * (space.EntrySize.z * 0.32f))
                    : new Vector3(space.EntryCenter.x + lane * (space.EntrySize.x * 0.34f),
                        space.EntryFloor + 1.8f, space.EntryCenter.z + along);
                CreateServerBank(banks, "ArchiveBank_" + index, position,
                    variantB ? Quaternion.Euler(0f, 90f, 0f) : Quaternion.identity, materials);
            }
            Transform pylons = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.DataPylons);
            for (int index = 0; index < 3; index += 1)
            {
                float angle = variantB ? 40f + index * 120f : index * 120f;
                Vector3 offset = Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 3.2f);
                GameObject pylon = CreateCylinderProp(pylons, "MemoryPylon_" + index,
                    space.EntryCenter + offset + Vector3.up * (space.EntryFloor + 1.5f),
                    0.65f, 3f, materials.FactoryWall);
                CreateBoxProp(pylon.transform, "DataLens", new Vector3(0f, 0.4f, 0.58f),
                    new Vector3(0.55f, 0.8f, 0.12f), materials.FactoryConduit);
            }
        }

        private static void BuildFluidTankChamber(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform tanks = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.FluidTanks);
            Vector3[] offsets = variantB
                ? new[] { new Vector3(-6f, 0f, -5f), new Vector3(0f, 0f, 5f), new Vector3(6f, 0f, -5f) }
                : new[] { new Vector3(-6f, 0f, 3.5f), new Vector3(0f, 0f, 3.5f), new Vector3(6f, 0f, 3.5f) };
            foreach ((Vector3 offset, int index) in offsets.Select((value, index) => (value, index)))
            {
                Vector3 position = space.EntryCenter + offset + Vector3.up * (space.EntryFloor + 2.4f);
                CreateTank(tanks, "CoolantTank_" + index, position, 1.8f, 4.8f, materials);
            }
            Transform valves = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.Valves);
            for (int index = 0; index < 3; index += 1)
            {
                Vector3 position = space.EntryCenter
                    + new Vector3((index - 1) * 4.5f, space.EntryFloor + 1.1f,
                        variantB ? -5f : -3.8f);
                CreateValveWheel(valves, "RoutingValve_" + index, position,
                    Quaternion.Euler(0f, variantB ? 90f : 0f, 0f), materials.WaterworksPipes);
            }
            CreatePipe(tanks, "HeaderPipe",
                space.EntryCenter + new Vector3(-7f, space.EntryFloor + 5.2f, 0f),
                space.EntryCenter + new Vector3(7f, space.EntryFloor + 5.2f, 0f),
                0.3f, materials.WaterworksPipes);
        }

        private static void BuildRechargeChamber(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform pods = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.RechargePods);
            Transform cradles = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.ReaverbotCradles);
            int podCount = variantB ? 5 : 4;
            for (int index = 0; index < podCount; index += 1)
            {
                float t = podCount == 1 ? 0f : index / (float)(podCount - 1);
                Vector3 position = variantB
                    ? new Vector3(space.EntryCenter.x + Mathf.Lerp(-6f, 6f, t),
                        space.EntryFloor + 2f, space.EntryCenter.z + (index % 2 == 0 ? 4.6f : 2.8f))
                    : new Vector3(space.EntryCenter.x - 6.5f,
                        space.EntryFloor + 2f, space.EntryCenter.z + Mathf.Lerp(-5f, 5f, t));
                GameObject pod = CreateCylinderProp(pods, "RechargePod_" + index,
                    position, 1.25f, 4f, materials.FactoryWall);
                CreateBoxProp(pod.transform, "ChargeWindow", new Vector3(0f, 0f, 1.05f),
                    new Vector3(1.3f, 2.5f, 0.12f), materials.FactoryConduit);
                GameObject cradle = CreateBoxProp(cradles, "ReaverbotCradle_" + index,
                    position + new Vector3(0f, -1.7f, 1.1f),
                    new Vector3(2.6f, 0.35f, 2.6f), materials.FactoryCatwalk);
                CreatePipe(cradle.transform, "CradleArmL", new Vector3(-0.9f, 0f, 0f),
                    new Vector3(-0.9f, 1.4f, 0.6f), 0.12f, materials.FactoryConduit);
                CreatePipe(cradle.transform, "CradleArmR", new Vector3(0.9f, 0f, 0f),
                    new Vector3(0.9f, 1.4f, 0.6f), 0.12f, materials.FactoryConduit);
            }
        }

        private static void BuildReaverbotNest(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform machinery = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.NestMachinery);
            GameObject core = CreateCylinderProp(machinery, "NestAssemblyCore",
                space.EntryCenter + Vector3.up * (space.EntryFloor + 1.5f),
                variantB ? 2.4f : 3f, 3f, materials.FactoryWall);
            for (int index = 0; index < 4; index += 1)
            {
                float angle = index * 90f + (variantB ? 45f : 0f);
                Vector3 start = space.EntryCenter + Vector3.up * (space.EntryFloor + 2.5f);
                Vector3 end = start + Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 5f);
                CreatePipe(machinery, "AssemblyTentacle_" + index, start, end, 0.28f,
                    materials.FactoryConduit);
            }
            CreateSphereProp(core.transform, "DormantNestEye", new Vector3(0f, 0.3f, 2.5f),
                0.55f, materials.ElectricalLive);

            Transform salvage = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.SalvageSorting);
            int piles = variantB ? 6 : 4;
            for (int index = 0; index < piles; index += 1)
            {
                float angle = (360f / piles) * index + (variantB ? 15f : 0f);
                Vector3 offset = Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 7f);
                GameObject pile = Empty(salvage, "SortedSalvagePile_" + index);
                pile.transform.localPosition = space.EntryCenter + offset;
                for (int part = 0; part < 5; part += 1)
                {
                    CreateBoxProp(pile.transform, "RecoveredPart_" + part,
                        new Vector3((part % 2) * 0.65f, space.EntryFloor + 0.2f + part * 0.18f,
                            (part % 3) * 0.45f),
                        new Vector3(0.8f, 0.35f, 0.55f), materials.FactoryWall,
                        Quaternion.Euler(part * 11f, part * 31f, part * 7f));
                }
            }
        }

        private static void BuildAssemblyLine(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform conveyors = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.Conveyors);
            int lanes = variantB ? 3 : 2;
            for (int lane = 0; lane < lanes; lane += 1)
            {
                Vector3 position = variantB
                    ? new Vector3(space.EntryCenter.x + (lane - 1) * 5f,
                        space.EntryFloor + 0.65f, space.EntryCenter.z)
                    : new Vector3(space.EntryCenter.x, space.EntryFloor + 0.65f,
                        space.EntryCenter.z + (lane == 0 ? -4f : 4f));
                Vector3 size = variantB ? new Vector3(2.4f, 0.6f, 13f) : new Vector3(15f, 0.6f, 2.4f);
                GameObject belt = CreateBoxProp(conveyors, "ConveyorLane_" + lane,
                    position, size, materials.FactoryCatwalk);
                for (int roller = -3; roller <= 3; roller += 1)
                {
                    Vector3 local = variantB
                        ? new Vector3(0f, 0.35f, roller * 1.7f)
                        : new Vector3(roller * 1.7f, 0.35f, 0f);
                    CreateCylinderProp(belt.transform, "Roller_" + roller, local, 0.18f, 2.2f,
                        materials.FactoryConduit,
                        variantB ? Quaternion.Euler(0f, 0f, 90f) : Quaternion.Euler(90f, 0f, 0f));
                }
            }
            Transform arms = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.RobotArms);
            for (int index = 0; index < 4; index += 1)
            {
                Vector3 position = variantB
                    ? new Vector3(space.EntryCenter.x + (index % 2 == 0 ? -7f : 7f),
                        space.EntryFloor, space.EntryCenter.z + (index / 2 == 0 ? -4f : 4f))
                    : new Vector3(space.EntryCenter.x + (index / 2 == 0 ? -5f : 5f),
                        space.EntryFloor, space.EntryCenter.z + (index % 2 == 0 ? -7f : 7f));
                CreateRobotArm(arms, "AssemblyArm_" + index, position,
                    variantB ? 35f + index * 15f : -35f + index * 20f, materials);
            }
        }

        private static void BuildPumpAndCoolantWorks(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform pumps = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.Pumps);
            int pumpCount = variantB ? 4 : 3;
            for (int index = 0; index < pumpCount; index += 1)
            {
                float x = space.EntryCenter.x + (index - (pumpCount - 1) * 0.5f) * 4.5f;
                Vector3 position = new Vector3(x, space.EntryFloor + 1.1f,
                    space.EntryCenter.z + (variantB && index % 2 == 0 ? 4f : -3.5f));
                GameObject pump = CreateCylinderProp(pumps, "CentrifugalPump_" + index,
                    position, 1.35f, 2.2f, materials.WaterworksPipes,
                    Quaternion.Euler(90f, 0f, 0f));
                CreateCylinderProp(pump.transform, "ImpellerHousing", new Vector3(0f, 0f, 1.2f),
                    1.65f, 0.55f, materials.FactoryWall, Quaternion.Euler(90f, 0f, 0f));
            }
            Transform valves = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.Valves);
            for (int index = 0; index < 3; index += 1)
                CreateValveWheel(valves, "CoolantValve_" + index,
                    space.EntryCenter + new Vector3((index - 1) * 4f, space.EntryFloor + 2.2f, 5.5f),
                    Quaternion.identity, materials.WaterworksPipes);

            Transform manifold = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.CoolantManifold);
            float headerZ = space.EntryCenter.z + (variantB ? -5.5f : 5.5f);
            CreatePipe(manifold, "MainCoolantHeader",
                new Vector3(space.EntryCenter.x - 8f, space.EntryFloor + 4.5f, headerZ),
                new Vector3(space.EntryCenter.x + 8f, space.EntryFloor + 4.5f, headerZ),
                0.45f, materials.WaterworksPipes);
            for (int index = -2; index <= 2; index += 1)
                CreatePipe(manifold, "ManifoldDrop_" + index,
                    new Vector3(space.EntryCenter.x + index * 3f, space.EntryFloor + 4.5f, headerZ),
                    new Vector3(space.EntryCenter.x + index * 3f, space.EntryFloor + 0.8f,
                        headerZ + (variantB ? 2f : -2f)),
                    0.24f, materials.WaterworksPipes);
        }

        private static void BuildReactorSupport(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform supports = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.ReactorSupports);
            GameObject reactor = CreateCylinderProp(supports, "ReactorContainmentColumn",
                space.EntryCenter + Vector3.up * (space.EntryFloor + 3.4f),
                variantB ? 3.4f : 4f, 6.8f, materials.FactoryWall);
            CreateCylinderProp(reactor.transform, "ReactorPulseCore", Vector3.zero,
                variantB ? 2.5f : 3f, 7f, materials.FactoryConduit);
            for (int index = 0; index < 6; index += 1)
            {
                float angle = index * 60f + (variantB ? 30f : 0f);
                Vector3 radial = Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 6f);
                CreatePipe(supports, "ContainmentStrut_" + index,
                    space.EntryCenter + radial + Vector3.up * (space.EntryFloor + 0.4f),
                    space.EntryCenter + radial * 0.45f + Vector3.up * (space.EntryFloor + 4.5f),
                    0.35f, materials.FactoryCatwalk);
            }

            Transform turbines = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.Turbines);
            int turbineCount = variantB ? 3 : 2;
            for (int index = 0; index < turbineCount; index += 1)
            {
                float angle = index * (360f / turbineCount) + 25f;
                Vector3 offset = Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 8f);
                GameObject turbine = CreateCylinderProp(turbines, "ReactorTurbine_" + index,
                    space.EntryCenter + offset + Vector3.up * (space.EntryFloor + 2f),
                    1.8f, 1.2f, materials.FactoryConduit,
                    Quaternion.LookRotation(-offset.normalized, Vector3.up) * Quaternion.Euler(90f, 0f, 0f));
                for (int blade = 0; blade < 6; blade += 1)
                    CreateBoxProp(turbine.transform, "Blade_" + blade,
                        Quaternion.Euler(0f, blade * 60f, 0f) * new Vector3(0f, 0f, 1.2f),
                        new Vector3(0.25f, 0.22f, 1.8f), materials.FactoryCatwalk,
                        Quaternion.Euler(0f, blade * 60f, 0f));
            }
        }

        private static void BuildSecurityCheckpoint(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform bulkheads = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.SecurityBulkheads);
            float barrierZ = space.EntryCenter.z + (variantB ? 2f : 0f);
            for (int side = -1; side <= 1; side += 2)
            {
                CreateBoxProp(bulkheads, "ArmoredGatePillar_" + side,
                    new Vector3(space.EntryCenter.x + side * 2.3f, space.EntryFloor + 2.3f, barrierZ),
                    new Vector3(1.2f, 4.6f, 1.6f), materials.FactoryWall);
            }
            CreateBoxProp(bulkheads, "BulkheadHeader",
                new Vector3(space.EntryCenter.x, space.EntryFloor + 4.6f, barrierZ),
                new Vector3(5.8f, 0.8f, 1.6f), materials.FactoryWall);
            if (variantB)
            {
                CreateBoxProp(bulkheads, "InspectionLaneDivider",
                    new Vector3(space.EntryCenter.x - 4f, space.EntryFloor + 1f,
                        space.EntryCenter.z - 2.5f),
                    new Vector3(0.35f, 2f, 7f), materials.FactoryCatwalk);
                CreateBoxProp(bulkheads, "InspectionLaneDividerB",
                    new Vector3(space.EntryCenter.x + 4f, space.EntryFloor + 1f,
                        space.EntryCenter.z - 2.5f),
                    new Vector3(0.35f, 2f, 7f), materials.FactoryCatwalk);
            }

            Transform credentials = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.CredentialConsole);
            CreateConsole(credentials, "CredentialVerificationConsole",
                new Vector3(space.EntryCenter.x + (variantB ? 5.5f : -5.5f),
                    space.EntryFloor + 1f, space.EntryCenter.z - 3.5f),
                materials.FactoryWall, materials.ElectricalLive);
            CreateCylinderProp(credentials, "CredentialScanner",
                new Vector3(space.EntryCenter.x + (variantB ? -5.5f : 5.5f),
                    space.EntryFloor + 1.25f, space.EntryCenter.z - 3.5f),
                0.65f, 2.5f, materials.FactoryConduit);
        }

        private static void BuildVerticalMaintenanceShaft(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform lift = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.LiftMachinery);
            GameObject hoist = CreateCylinderProp(lift, "CentralHoistDrum",
                space.EntryCenter + Vector3.up * (space.EntryFloor + 4f),
                1.8f, 2.5f, materials.FactoryConduit,
                Quaternion.Euler(90f, 0f, 0f));
            CreatePipe(lift, "HoistCableA",
                space.EntryCenter + new Vector3(-0.7f, space.EntryFloor + 0.2f, 0f),
                space.EntryCenter + new Vector3(-0.7f, space.EntryCeiling - 0.5f, 0f),
                0.09f, materials.FactoryConduit);
            CreatePipe(lift, "HoistCableB",
                space.EntryCenter + new Vector3(0.7f, space.EntryFloor + 0.2f, 0f),
                space.EntryCenter + new Vector3(0.7f, space.EntryCeiling - 0.5f, 0f),
                0.09f, materials.FactoryConduit);
            CreateBoxProp(hoist.transform, "HoistMotor", new Vector3(0f, 0f, 1.5f),
                new Vector3(2.5f, 1.4f, 1.4f), materials.FactoryWall);

            Transform scaffold = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.MaintenanceScaffolds);
            int levels = variantB ? 4 : 3;
            for (int level = 0; level < levels; level += 1)
            {
                float y = space.EntryFloor + 1.6f + level * 2.2f;
                float side = (level + (variantB ? 1 : 0)) % 2 == 0 ? -1f : 1f;
                Vector3 platformCenter = new Vector3(
                    space.EntryCenter.x + side * (space.EntrySize.x * 0.27f),
                    y, space.EntryCenter.z + (variantB ? (level - 1.5f) * 1.2f : 0f));
                CreateBoxProp(scaffold, "MaintenanceLanding_" + level, platformCenter,
                    new Vector3(5f, 0.25f, 3.2f), materials.FactoryCatwalk);
                CreatePipe(scaffold, "LandingBrace_" + level,
                    platformCenter + new Vector3(-2f, -1.4f, 0f),
                    platformCenter + new Vector3(2f, 0f, 0f),
                    0.12f, materials.FactoryConduit);
            }
        }

        private static void BuildPartsWarehouse(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform racks = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.StorageRacks);
            int rows = variantB ? 3 : 2;
            for (int row = 0; row < rows; row += 1)
            {
                float lane = (row - (rows - 1) * 0.5f) * 5.5f;
                Vector3 center = variantB
                    ? new Vector3(space.EntryCenter.x + lane, space.EntryFloor + 2.2f, space.EntryCenter.z)
                    : new Vector3(space.EntryCenter.x, space.EntryFloor + 2.2f, space.EntryCenter.z + lane);
                GameObject rack = Empty(racks, "PartsRackRow_" + row);
                rack.transform.localPosition = center;
                bool rotate = !variantB;
                rack.transform.localRotation = Quaternion.Euler(0f, rotate ? 90f : 0f, 0f);
                for (int post = -1; post <= 1; post += 2)
                    CreateBoxProp(rack.transform, "RackPost_" + post,
                        new Vector3(post * 3.5f, 0f, 0f), new Vector3(0.3f, 4.4f, 0.8f), materials.FactoryWall);
                for (int shelf = -1; shelf <= 1; shelf += 1)
                {
                    CreateBoxProp(rack.transform, "Shelf_" + shelf,
                        new Vector3(0f, shelf * 1.5f, 0f), new Vector3(7.4f, 0.2f, 1.8f),
                        materials.FactoryCatwalk);
                    for (int crate = -2; crate <= 2; crate += 1)
                        CreateCrate(rack.transform, "PartBin_" + shelf + "_" + crate,
                            new Vector3(crate * 1.25f, shelf * 1.5f + 0.55f, 0f), 0.9f, materials);
                }
            }

            Transform crane = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.CargoCrane);
            float craneY = Mathf.Min(space.EntryCeiling - 1.2f, space.EntryFloor + 8f);
            CreateBoxProp(crane, "OverheadCraneRail",
                new Vector3(space.EntryCenter.x, craneY, space.EntryCenter.z),
                variantB ? new Vector3(0.7f, 0.7f, 15f) : new Vector3(15f, 0.7f, 0.7f),
                materials.FactoryCatwalk);
            CreateBoxProp(crane, "CraneTrolley",
                new Vector3(space.EntryCenter.x + (variantB ? 0f : 3f), craneY - 0.6f,
                    space.EntryCenter.z + (variantB ? 3f : 0f)),
                new Vector3(2.4f, 1.1f, 2.4f), materials.FactoryWall);
            CreatePipe(crane, "CraneCable",
                new Vector3(space.EntryCenter.x + (variantB ? 0f : 3f), craneY - 1f,
                    space.EntryCenter.z + (variantB ? 3f : 0f)),
                new Vector3(space.EntryCenter.x + (variantB ? 0f : 3f), space.EntryFloor + 2f,
                    space.EntryCenter.z + (variantB ? 3f : 0f)),
                0.08f, materials.FactoryConduit);
        }

        private static void BuildHazardProcessing(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform furnace = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.FurnaceInfrastructure);
            Vector3 furnacePosition = space.EntryCenter
                + new Vector3(variantB ? -5f : 0f, space.EntryFloor + 2.4f, variantB ? 4f : 5f);
            GameObject kiln = CreateCylinderProp(furnace, "SealedFurnaceKiln", furnacePosition,
                variantB ? 2f : 3.5f, variantB ? 4f : 4.8f, materials.MagmaWall,
                Quaternion.Euler(90f, 0f, 0f));
            CreateCylinderProp(kiln.transform, "FurnaceMouth", new Vector3(0f, 0f, 1.7f),
                variantB ? 1.4f : 2.6f, 0.5f, materials.MagmaSurface,
                Quaternion.Euler(90f, 0f, 0f));
            CreatePipe(furnace, "FurnaceExhaust", furnacePosition + Vector3.up * 1.2f,
                furnacePosition + Vector3.up * 5.5f, 0.45f, materials.MagmaWall);

            Transform transformers = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.TransformerInfrastructure);
            int transformerCount = variantB ? 4 : 2;
            for (int index = 0; index < transformerCount; index += 1)
            {
                Vector3 position = space.EntryCenter + new Vector3(
                    (index - (transformerCount - 1) * 0.5f) * 3.8f,
                    space.EntryFloor + 1.7f,
                    variantB ? -4.5f : -5.5f);
                GameObject transformer = CreateBoxProp(transformers, "TransformerBank_" + index,
                    position, new Vector3(2.6f, 3.4f, 2.2f), materials.ElectricalWall);
                for (int coil = -1; coil <= 1; coil += 2)
                    CreateCylinderProp(transformer.transform, "CopperCoil_" + coil,
                        new Vector3(coil * 0.65f, 0.3f, 1.1f), 0.45f, 1.1f,
                        variantB ? materials.ElectricalLive : materials.FactoryConduit,
                        Quaternion.Euler(90f, 0f, 0f));
            }
        }

        private static void BuildSurveillanceTheater(
            Transform parent, ModuleSpace space, bool variantB, MaterialSet materials)
        {
            Transform displays = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.SurveillanceDisplays);
            int displayCount = variantB ? 8 : 6;
            for (int index = 0; index < displayCount; index += 1)
            {
                float t = displayCount == 1 ? 0f : index / (float)(displayCount - 1);
                float x = Mathf.Lerp(-7f, 7f, t);
                float z = variantB ? 5.5f - Mathf.Abs(x) * 0.15f : 5.5f;
                GameObject monitor = CreateMonitor(displays, "SurveillanceDisplay_" + index,
                    space.EntryCenter + new Vector3(x, space.EntryFloor + 3.2f, z),
                    materials, Quaternion.Euler(variantB ? -8f : 0f, 180f, 0f));
                if (variantB) monitor.transform.localScale *= index % 2 == 0 ? 1.12f : 0.88f;
            }

            Transform dais = FeatureGroup(parent, DungeonModuleSemanticFeatureV2.ControlDais);
            Vector3 daisCenter = space.EntryCenter
                + new Vector3(variantB ? -2f : 0f, space.EntryFloor + 0.4f,
                    variantB ? -1f : -2.5f);
            CreateCylinderProp(dais, "PanopticonControlDais", daisCenter,
                variantB ? 4.2f : 3.5f, 0.8f, materials.FactoryCatwalk);
            int consoles = variantB ? 5 : 4;
            for (int index = 0; index < consoles; index += 1)
            {
                float angle = 180f + index * (180f / Math.Max(1, consoles - 1));
                Vector3 offset = Quaternion.Euler(0f, angle, 0f) * new Vector3(0f, 0f, 2.6f);
                CreateConsole(dais, "ObserverConsole_" + index,
                    daisCenter + offset + Vector3.up * 0.8f,
                    materials.FactoryWall, materials.ElectricalLive,
                    Quaternion.Euler(0f, angle, 0f));
            }
        }

        private static Transform FeatureGroup(Transform parent, DungeonModuleSemanticFeatureV2 feature)
        {
            GameObject group = Empty(parent, feature.ToString());
            group.AddComponent<DungeonSemanticFeatureAuthoringV2>().Configure(feature);
            return group.transform;
        }

        private static void CreateLightingRig(
            Transform parent,
            ModuleSpace space,
            DungeonLightingProfileV2 profile,
            int rigIndex,
            int rigCount,
            MaterialSet materials,
            bool shadowed)
        {
            GameObject rig = Empty(parent, "LightingRig_" + profile);
            rig.AddComponent<DungeonLightingRigAuthoringV2>().Configure(profile, 2, shadowed ? 1 : 0);
            (Color colorA, Color colorB, float intensity) = profile switch
            {
                DungeonLightingProfileV2.WaterworksCyan =>
                    (new Color(0.12f, 0.72f, 0.9f), new Color(0.15f, 0.4f, 0.8f), 2.2f),
                DungeonLightingProfileV2.MagmaUnderlight =>
                    (new Color(1f, 0.22f, 0.03f), new Color(1f, 0.55f, 0.08f), 2.8f),
                DungeonLightingProfileV2.ElectricalSafeChargeLive =>
                    (new Color(0.15f, 0.45f, 1f), new Color(0.45f, 0.8f, 1f), 2.6f),
                DungeonLightingProfileV2.SecurityColdWhite =>
                    (new Color(0.68f, 0.82f, 1f), new Color(0.25f, 0.8f, 0.75f), 1.9f),
                DungeonLightingProfileV2.ReactorPulse =>
                    (new Color(0.15f, 0.9f, 0.85f), new Color(1f, 0.48f, 0.08f), 2.4f),
                _ => (new Color(0.08f, 0.75f, 0.72f), new Color(1f, 0.45f, 0.1f), 2.0f)
            };
            float zShift = (rigIndex - (rigCount - 1) * 0.5f) * 3.5f;
            CreateAuthoredLight(rig.transform, "Primary", space.EntryCenter
                + new Vector3(-space.EntrySize.x * 0.24f, space.EntryCeiling - 1.2f, zShift),
                colorA, intensity, Mathf.Max(8f, space.EntrySize.x * 0.45f), shadowed,
                materials.FactoryConduit);
            CreateAuthoredLight(rig.transform, "Secondary", space.EntryCenter
                + new Vector3(space.EntrySize.x * 0.24f, space.EntryFloor + 2.5f, -zShift),
                colorB, intensity * 0.75f, Mathf.Max(7f, space.EntrySize.z * 0.38f), false,
                materials.FactoryConduit);
        }

        private static void CreateAuthoredLight(
            Transform parent,
            string name,
            Vector3 position,
            Color color,
            float intensity,
            float range,
            bool shadowed,
            Material fixtureMaterial)
        {
            GameObject fixture = CreateBoxProp(parent, "Fixture_" + name, position,
                new Vector3(1.4f, 0.25f, 0.55f), fixtureMaterial);
            GameObject lightObject = Empty(fixture.transform, "Light_" + name);
            lightObject.transform.localPosition = new Vector3(0f, -0.2f, 0f);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = shadowed ? LightShadows.Soft : LightShadows.None;
            light.renderMode = LightRenderMode.ForcePixel;
        }

        private static GameObject CreateServerBank(
            Transform parent, string name, Vector3 position, Quaternion rotation, MaterialSet materials)
        {
            GameObject bank = CreateBoxProp(parent, name, position,
                new Vector3(2.2f, 3.6f, 1.1f), materials.FactoryWall, rotation);
            for (int panel = -1; panel <= 1; panel += 1)
                CreateBoxProp(bank.transform, "DataPanel_" + panel,
                    new Vector3(0f, panel * 1.05f, 0.58f),
                    new Vector3(1.65f, 0.72f, 0.08f), materials.FactoryConduit);
            return bank;
        }

        private static GameObject CreateTank(
            Transform parent, string name, Vector3 position, float radius, float height, MaterialSet materials)
        {
            GameObject tank = CreateCylinderProp(parent, name, position, radius, height,
                materials.WaterworksPipes);
            for (int ring = -1; ring <= 1; ring += 1)
                CreateCylinderProp(tank.transform, "ReinforcementRing_" + ring,
                    new Vector3(0f, ring * height * 0.32f, 0f), radius * 1.08f, 0.22f,
                    materials.FactoryWall);
            CreatePipe(tank.transform, "TankFeed", new Vector3(0f, height * 0.42f, 0f),
                new Vector3(radius + 1.2f, height * 0.42f, 0f), 0.2f, materials.WaterworksPipes);
            return tank;
        }

        private static GameObject CreateValveWheel(
            Transform parent, string name, Vector3 position, Quaternion rotation, Material material)
        {
            GameObject wheel = Empty(parent, name);
            wheel.transform.localPosition = position;
            wheel.transform.localRotation = rotation;
            CreateCylinderProp(wheel.transform, "ValveHub", Vector3.zero, 0.38f, 0.3f,
                material, Quaternion.Euler(90f, 0f, 0f));
            for (int spoke = 0; spoke < 8; spoke += 1)
            {
                float angle = spoke * 45f;
                CreateBoxProp(wheel.transform, "Spoke_" + spoke,
                    Quaternion.Euler(0f, 0f, angle) * new Vector3(0.75f, 0f, 0f),
                    new Vector3(1.45f, 0.12f, 0.14f), material,
                    Quaternion.Euler(0f, 0f, angle));
            }
            return wheel;
        }

        private static GameObject CreateRobotArm(
            Transform parent, string name, Vector3 position, float yaw, MaterialSet materials)
        {
            GameObject arm = Empty(parent, name);
            arm.transform.localPosition = position;
            arm.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            CreateCylinderProp(arm.transform, "RotaryBase", new Vector3(0f, 0.5f, 0f),
                0.9f, 1f, materials.FactoryWall);
            CreatePipe(arm.transform, "LowerArm", new Vector3(0f, 0.9f, 0f),
                new Vector3(0f, 2.6f, 1.3f), 0.3f, materials.FactoryConduit);
            CreateSphereProp(arm.transform, "ElbowJoint", new Vector3(0f, 2.6f, 1.3f),
                0.52f, materials.FactoryWall);
            CreatePipe(arm.transform, "UpperArm", new Vector3(0f, 2.6f, 1.3f),
                new Vector3(0f, 2f, 3.2f), 0.25f, materials.FactoryConduit);
            CreateBoxProp(arm.transform, "ToolClaw", new Vector3(0f, 2f, 3.35f),
                new Vector3(1.1f, 0.35f, 0.65f), materials.FactoryCatwalk);
            return arm;
        }

        private static GameObject CreateMonitor(
            Transform parent, string name, Vector3 position, MaterialSet materials, Quaternion rotation)
        {
            GameObject monitor = CreateBoxProp(parent, name, position,
                new Vector3(2.4f, 1.65f, 0.35f), materials.FactoryWall, rotation);
            CreateBoxProp(monitor.transform, "DisplayGlass", new Vector3(0f, 0f, -0.2f),
                new Vector3(2f, 1.25f, 0.08f), materials.ElectricalLive);
            return monitor;
        }

        private static GameObject CreateConsole(
            Transform parent,
            string name,
            Vector3 position,
            Material bodyMaterial,
            Material screenMaterial,
            Quaternion? rotation = null)
        {
            GameObject console = CreateBoxProp(parent, name, position,
                new Vector3(1.8f, 1.7f, 1.3f), bodyMaterial,
                rotation ?? Quaternion.identity);
            CreateBoxProp(console.transform, "ConsoleScreen", new Vector3(0f, 0.35f, 0.68f),
                new Vector3(1.35f, 0.72f, 0.08f), screenMaterial,
                Quaternion.Euler(-12f, 0f, 0f));
            return console;
        }

        private static GameObject CreateCrate(
            Transform parent, string name, Vector3 position, float size, MaterialSet materials)
        {
            GameObject crate = CreateBoxProp(parent, name, position,
                new Vector3(size, size, size), materials.FactoryWall);
            CreateBoxProp(crate.transform, "CrateBand", Vector3.zero,
                new Vector3(size * 1.04f, size * 0.18f, size * 1.04f), materials.FactoryCatwalk);
            return crate;
        }

        private static GameObject CreateBoxProp(
            Transform parent,
            string name,
            Vector3 position,
            Vector3 size,
            Material material,
            Quaternion? variantRotation = null) =>
            CreatePrimitiveWithoutCollider(
                PrimitiveType.Cube,
                parent,
                name,
                position,
                size,
                variantRotation ?? Quaternion.identity,
                material);

        private static GameObject CreateCylinderProp(
            Transform parent,
            string name,
            Vector3 position,
            float radius,
            float height,
            Material material,
            Quaternion? rotation = null) =>
            CreatePrimitiveWithoutCollider(
                PrimitiveType.Cylinder,
                parent,
                name,
                position,
                new Vector3(radius, height * 0.5f, radius),
                rotation ?? Quaternion.identity,
                material);

        private static GameObject CreateSphereProp(
            Transform parent,
            string name,
            Vector3 position,
            float radius,
            Material material) =>
            CreatePrimitiveWithoutCollider(
                PrimitiveType.Sphere,
                parent,
                name,
                position,
                Vector3.one * (radius * 2f),
                Quaternion.identity,
                material);

        private static GameObject CreatePipe(
            Transform parent,
            string name,
            Vector3 start,
            Vector3 end,
            float radius,
            Material material)
        {
            Vector3 delta = end - start;
            if (delta.sqrMagnitude <= 0.000001f)
                throw new ArgumentException("Pipe endpoints must be distinct.", nameof(end));
            return CreateCylinderProp(
                parent,
                name,
                (start + end) * 0.5f,
                radius,
                delta.magnitude,
                material,
                Quaternion.FromToRotation(Vector3.up, delta.normalized));
        }

        private static GameObject CreatePrimitiveWithoutCollider(
            PrimitiveType primitive,
            Transform parent,
            string name,
            Vector3 localPosition,
            Vector3 localScale,
            Quaternion localRotation,
            Material material)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            // Keep the returned authored transform at unit scale so nested
            // brackets, screens, pipes, and mechanisms do not inherit the
            // primitive mesh's dimensional scale.
            GameObject item = Empty(parent, name);
            item.transform.localPosition = localPosition;
            item.transform.localRotation = localRotation;
            GameObject meshObject = GameObject.CreatePrimitive(primitive);
            meshObject.name = "TexturedMesh";
            meshObject.transform.SetParent(item.transform, false);
            meshObject.transform.localScale = localScale;
            Collider collider = meshObject.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            meshObject.GetComponent<Renderer>().sharedMaterial = material;
            return item;
        }

        private static GameObject CreateDirectPrimitiveWithoutCollider(
            PrimitiveType primitive,
            Transform parent,
            string name,
            Vector3 localPosition,
            Vector3 localScale,
            Quaternion localRotation,
            Material material)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            GameObject item = GameObject.CreatePrimitive(primitive);
            item.name = name;
            item.transform.SetParent(parent, false);
            item.transform.localPosition = localPosition;
            item.transform.localRotation = localRotation;
            item.transform.localScale = localScale;
            Collider collider = item.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            item.GetComponent<Renderer>().sharedMaterial = material;
            return item;
        }

        private static TextMesh AddAuthoredPrompt(Transform parent, string text) =>
            AddAuthoredLabel(parent, "[INTERACT] " + text, 2.15f, "InteractionPrompt");

        private static TextMesh AddAuthoredLabel(
            Transform parent,
            string text,
            float localY,
            string objectName = "AuthoredLabel")
        {
            GameObject labelObject = Empty(parent, objectName);
            labelObject.transform.localPosition = Vector3.up * localY;
            var label = labelObject.AddComponent<TextMesh>();
            label.text = text;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.fontSize = 56;
            label.characterSize = 0.045f;
            label.color = new Color(0.72f, 1f, 1f, 1f);
            return label;
        }

        private static string Humanize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "SYSTEM";
            return value.Replace('-', ' ').Replace('_', ' ').ToUpperInvariant();
        }

        private static GameObject BuildBulkheadCap(Material material)
        {
            GameObject root = new GameObject("IndustrialBulkheadCapV2");
            // The cap prefab is instantiated at a connector-local origin. Keep
            // its blocker on the root so validation can prove the authored cap
            // closes the exact certified 2.5 x 3.65 metre aperture. Presentation
            // children intentionally remain collider-free.
            var blocker = root.AddComponent<BoxCollider>();
            blocker.center = new Vector3(0f, 1.325f, 0f);
            blocker.size = new Vector3(2.5f, 3.65f, 0.24f);
            CreateBoxProp(root.transform, "TexturedBulkheadDoor",
                new Vector3(0f, 1.325f, 0f),
                new Vector3(2.5f, 3.65f, 0.24f),
                material);
            for (int side = -1; side <= 1; side += 2)
                CreateBoxProp(root.transform, "SealGasket_" + side,
                    new Vector3(side * 1.12f, 1.325f, -0.14f),
                    new Vector3(0.18f, 3.65f, 0.08f), material);
            return root;
        }

        private static void TryAddOptionalExtractedSetDress(
            IndustrialFactoryV2ModuleDefinition definition,
            Transform parent,
            ModuleSpace space)
        {
            string path = definition.Composition.Archetype switch
            {
                DungeonModuleArchetypeV2.AncientServerCrypt => OptionalExtractedPropPrefabs[0],
                DungeonModuleArchetypeV2.PumpAndCoolantWorks => OptionalExtractedPropPrefabs[1],
                DungeonModuleArchetypeV2.FluidTankChamber => OptionalExtractedPropPrefabs[1],
                DungeonModuleArchetypeV2.AssemblyLineHall => OptionalExtractedPropPrefabs[2],
                DungeonModuleArchetypeV2.ReaverbotRechargeChamber => OptionalExtractedPropPrefabs[2],
                _ => null
            };
            if (path == null) return;
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) return;
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            instance.name = "OptionalExtractedProjectPropSet";
            foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true))
                UnityEngine.Object.DestroyImmediate(collider);
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                UnityEngine.Object.DestroyImmediate(instance);
                return;
            }
            Bounds bounds = renderers[0].bounds;
            foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            float longest = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
            if (longest > 0.001f)
                instance.transform.localScale *= Mathf.Min(1f, Mathf.Min(space.EntrySize.x, space.EntrySize.z) * 0.28f / longest);
            bounds = instance.GetComponentsInChildren<Renderer>(true)[0].bounds;
            foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>(true).Skip(1))
                bounds.Encapsulate(renderer.bounds);
            Vector3 desired = parent.TransformPoint(space.EntryCenter
                + new Vector3(0f, space.EntryFloor + 0.1f, space.EntrySize.z * 0.2f));
            instance.transform.position += desired - new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
        }

        private static void EnsureUnityEquivalent(
            CertifiedDungeonModuleGeometryV2 expected,
            CertifiedDungeonModuleGeometryV2 actual)
        {
            if (!string.Equals(expected.TemplateId, actual.TemplateId, StringComparison.Ordinal)
                || expected.Surfaces.Count != actual.Surfaces.Count
                || expected.Regions.Count != actual.Regions.Count
                || expected.Anchors.Count != actual.Anchors.Count
                || expected.Connectors.Count != actual.Connectors.Count)
            {
                throw new InvalidOperationException(expected.TemplateId
                    + " live authoring does not preserve the pure descriptor record counts.");
            }

            foreach (CertifiedDungeonSurfaceGeometryV2 source in expected.Surfaces)
            {
                CertifiedDungeonSurfaceGeometryV2 target = actual.Surfaces.Single(value => value.Id == source.Id);
                if (source.RegionId != target.RegionId || source.Kind != target.Kind
                    || source.ColliderKind != target.ColliderKind
                    || source.IsStructural != target.IsStructural || source.IsWalkable != target.IsWalkable
                    || source.MaterialProfileId != target.MaterialProfileId
                    || source.ControllerId != target.ControllerId
                    || !PredicateEqual(source.ActivePredicate, target.ActivePredicate)
                    || !PrismNear(source.Volume, target.Volume))
                    throw new InvalidOperationException(expected.TemplateId + ": surface " + source.Id
                        + " drifted from the pure module descriptor beyond Unity float tolerance.");
                if (source.RampWedge != null
                    && (target.RampWedge == null
                        || !Near(source.RampWedge.LowSurfaceY, target.RampWedge.LowSurfaceY)
                        || !Near(source.RampWedge.HighSurfaceY, target.RampWedge.HighSurfaceY)
                        || !PointNear(source.RampWedge.RiseDirection, target.RampWedge.RiseDirection)))
                    throw new InvalidOperationException(expected.TemplateId + ": ramp " + source.Id
                        + " drifted from the exact wedge contract.");
            }
            foreach (CertifiedDungeonRegionGeometryV2 source in expected.Regions)
            {
                CertifiedDungeonRegionGeometryV2 target = actual.Regions.Single(value => value.Id == source.Id);
                if (source.DistrictKind != target.DistrictKind
                    || source.ElevationStratum != target.ElevationStratum
                    || source.LocalNavigationRegionId != target.LocalNavigationRegionId
                    || !PointNear(source.Bounds.Minimum, target.Bounds.Minimum)
                    || !PointNear(source.Bounds.Maximum, target.Bounds.Maximum))
                    throw new InvalidOperationException(expected.TemplateId + ": region " + source.Id + " drifted.");
            }
            foreach (CertifiedDungeonAnchorGeometryV2 source in expected.Anchors)
            {
                CertifiedDungeonAnchorGeometryV2 target = actual.Anchors.Single(value => value.Id == source.Id);
                if (source.RegionId != target.RegionId || source.Kind != target.Kind
                    || source.ProfileId != target.ProfileId || !PointNear(source.Position, target.Position))
                    throw new InvalidOperationException(expected.TemplateId + ": anchor " + source.Id + " drifted.");
            }
            foreach (CertifiedDungeonConnectorGeometryV2 source in expected.Connectors)
            {
                CertifiedDungeonConnectorGeometryV2 target = actual.Connectors.Single(value => value.Id == source.Id);
                if (source.RegionId != target.RegionId || source.Kind != target.Kind
                    || source.SocketTag != target.SocketTag || !PointNear(source.Position, target.Position)
                    || !PointNear(source.Facing, target.Facing)
                    || !PrismNear(source.Aperture.LocalVolume, target.Aperture.LocalVolume)
                    || source.Aperture.ThemedCapProfileId != target.Aperture.ThemedCapProfileId
                    || source.Aperture.NavigationHandoffProfileId != target.Aperture.NavigationHandoffProfileId
                    || source.Aperture.ExteriorGasketProfileId != target.Aperture.ExteriorGasketProfileId
                    || source.Aperture.CapState != target.Aperture.CapState)
                    throw new InvalidOperationException(expected.TemplateId + ": connector " + source.Id + " drifted.");
            }
        }

        private static bool PrismNear(DungeonConvexPrismV2 left, DungeonConvexPrismV2 right)
        {
            if (!Near(left.MinimumY, right.MinimumY) || !Near(left.MaximumY, right.MaximumY)
                || left.HorizontalVertices.Count != right.HorizontalVertices.Count) return false;
            // Canonical baking may reverse winding. Compare as unordered points.
            return left.HorizontalVertices.All(point => right.HorizontalVertices.Any(other =>
                Near(point.X, other.X) && Near(point.Z, other.Z)));
        }

        private static bool PointNear(DungeonPoint3 left, DungeonPoint3 right) =>
            Near(left.X, right.X) && Near(left.Y, right.Y) && Near(left.Z, right.Z);

        private static bool PredicateEqual(
            DungeonAccessPredicateV2 left,
            DungeonAccessPredicateV2 right)
        {
            if (left == null || right == null || left.Clauses.Count != right.Clauses.Count)
                return false;
            for (int clauseIndex = 0; clauseIndex < left.Clauses.Count; clauseIndex += 1)
            {
                IReadOnlyList<DungeonPredicateConditionV2> leftConditions =
                    left.Clauses[clauseIndex].Conditions;
                IReadOnlyList<DungeonPredicateConditionV2> rightConditions =
                    right.Clauses[clauseIndex].Conditions;
                if (leftConditions.Count != rightConditions.Count) return false;
                for (int conditionIndex = 0; conditionIndex < leftConditions.Count; conditionIndex += 1)
                {
                    DungeonPredicateConditionV2 leftCondition = leftConditions[conditionIndex];
                    DungeonPredicateConditionV2 rightCondition = rightConditions[conditionIndex];
                    if (leftCondition.Kind != rightCondition.Kind
                        || leftCondition.Operator != rightCondition.Operator
                        || leftCondition.SubjectId != rightCondition.SubjectId
                        || leftCondition.ExpectedValue != rightCondition.ExpectedValue)
                        return false;
                }
            }
            return true;
        }

        private static bool Near(double left, double right) =>
            Math.Abs(left - right) <= GeometryTolerance;

        private static Vector3 ToUnity(DungeonPoint3 point) =>
            new Vector3(-(float)point.X, (float)point.Y, (float)point.Z);

        private static Vector3 ToUnityDirection(DungeonPoint3 direction) =>
            new Vector3(-(float)direction.X, (float)direction.Y, (float)direction.Z);

        private static Bounds ToUnityBounds(DungeonConvexPrismV2 prism)
        {
            float minimumX = -(float)prism.HorizontalVertices.Max(value => value.X);
            float maximumX = -(float)prism.HorizontalVertices.Min(value => value.X);
            float minimumZ = (float)prism.HorizontalVertices.Min(value => value.Z);
            float maximumZ = (float)prism.HorizontalVertices.Max(value => value.Z);
            var bounds = new Bounds();
            bounds.SetMinMax(
                new Vector3(minimumX, (float)prism.MinimumY, minimumZ),
                new Vector3(maximumX, (float)prism.MaximumY, maximumZ));
            return bounds;
        }

        private static LocalBox ToLocalBox(Transform localRoot, DungeonConvexPrismV2 prism)
        {
            var corners = new List<Vector3>(prism.HorizontalVertices.Count * 2);
            foreach (DungeonPoint2V2 point in prism.HorizontalVertices)
            {
                corners.Add(localRoot.InverseTransformPoint(
                    new Vector3(-(float)point.X, (float)prism.MinimumY, (float)point.Z)));
                corners.Add(localRoot.InverseTransformPoint(
                    new Vector3(-(float)point.X, (float)prism.MaximumY, (float)point.Z)));
            }
            Vector3 minimum = corners[0];
            Vector3 maximum = corners[0];
            foreach (Vector3 corner in corners.Skip(1))
            {
                minimum = Vector3.Min(minimum, corner);
                maximum = Vector3.Max(maximum, corner);
            }
            return new LocalBox((minimum + maximum) * 0.5f, maximum - minimum);
        }

        private static Transform Child(Transform parent, string name) => Empty(parent, name).transform;

        private static GameObject Empty(Transform parent, string name)
        {
            var item = new GameObject(name);
            item.transform.SetParent(parent, false);
            return item;
        }

        private readonly struct LocalBox
        {
            public LocalBox(Vector3 center, Vector3 size)
            {
                Center = center;
                Size = size;
            }
            public Vector3 Center { get; }
            public Vector3 Size { get; }
        }

        private readonly struct ModuleSpace
        {
            private ModuleSpace(
                Vector3 entryCenter,
                Vector3 entrySize,
                float entryFloor,
                float entryCeiling)
            {
                EntryCenter = entryCenter;
                EntrySize = entrySize;
                EntryFloor = entryFloor;
                EntryCeiling = entryCeiling;
            }

            public Vector3 EntryCenter { get; }
            public Vector3 EntrySize { get; }
            public float EntryFloor { get; }
            public float EntryCeiling { get; }

            public static ModuleSpace From(CertifiedDungeonModuleGeometryV2 geometry)
            {
                CertifiedDungeonRegionGeometryV2 entry = geometry.Regions.FirstOrDefault(value =>
                    string.Equals(value.Id, IndustrialFactoryV2ModuleCatalog.LocalRegionId,
                        StringComparison.Ordinal)) ?? geometry.Regions[0];
                Vector3 a = ToUnity(entry.Bounds.Minimum);
                Vector3 b = ToUnity(entry.Bounds.Maximum);
                Vector3 minimum = Vector3.Min(a, b);
                Vector3 maximum = Vector3.Max(a, b);
                return new ModuleSpace(
                    new Vector3(
                        (minimum.x + maximum.x) * 0.5f,
                        0f,
                        (minimum.z + maximum.z) * 0.5f),
                    maximum - minimum,
                    minimum.y,
                    maximum.y);
            }
        }

        private sealed class GeneratedMesh
        {
            public GeneratedMesh(string stableId, Mesh mesh)
            {
                StableId = stableId;
                Mesh = mesh;
            }
            public string StableId { get; }
            public Mesh Mesh { get; }
            public bool Persisted { get; set; }
        }

        private sealed class ModuleBuild : IDisposable
        {
            public ModuleBuild(
                IndustrialFactoryV2ModuleDefinition definition,
                GameObject root,
                DungeonModuleGeometryAuthoringV2 authoring,
                IReadOnlyList<GeneratedMesh> generatedMeshes)
            {
                Definition = definition;
                Root = root;
                Authoring = authoring;
                GeneratedMeshes = generatedMeshes;
            }

            public IndustrialFactoryV2ModuleDefinition Definition { get; }
            public GameObject Root { get; private set; }
            public DungeonModuleGeometryAuthoringV2 Authoring { get; }
            public IReadOnlyList<GeneratedMesh> GeneratedMeshes { get; }
            public CertifiedDungeonModuleGeometryV2 BakedGeometry { get; set; }

            public void Dispose()
            {
                if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
                Root = null;
                foreach (GeneratedMesh mesh in GeneratedMeshes)
                    if (!mesh.Persisted && mesh.Mesh != null) UnityEngine.Object.DestroyImmediate(mesh.Mesh);
            }
        }

        private sealed class MaterialSet
        {
            private const string Root = "Assets/RuinCrawler/Art/DungeonV2/Materials/";

            private MaterialSet()
            {
                FactoryFloor = Load("FactoryFloor");
                FactoryWall = Load("FactoryWall");
                FactoryCeiling = Load("FactoryCeiling");
                FactoryCatwalk = Load("FactoryCatwalk");
                FactoryConduit = Load("FactoryConduit");
                WaterworksFloor = Load("WaterworksFloor");
                WaterworksWall = Load("WaterworksWall");
                WaterworksPipes = Load("WaterworksPipes");
                WaterworksSurface = Load("WaterworksSurface");
                MagmaWall = Load("MagmaWall");
                MagmaCrust = Load("MagmaCrust");
                MagmaSafeDeck = Load("MagmaSafeDeck");
                MagmaSurface = Load("MagmaSurface");
                ElectricalWall = Load("ElectricalWall");
                ElectricalSafe = Load("ElectricalSafePanel");
                ElectricalLive = Load("ElectricalLivePanel");
            }

            public Material FactoryFloor { get; }
            public Material FactoryWall { get; }
            public Material FactoryCeiling { get; }
            public Material FactoryCatwalk { get; }
            public Material FactoryConduit { get; }
            public Material WaterworksFloor { get; }
            public Material WaterworksWall { get; }
            public Material WaterworksPipes { get; }
            public Material WaterworksSurface { get; }
            public Material MagmaWall { get; }
            public Material MagmaCrust { get; }
            public Material MagmaSafeDeck { get; }
            public Material MagmaSurface { get; }
            public Material ElectricalWall { get; }
            public Material ElectricalSafe { get; }
            public Material ElectricalLive { get; }

            public static MaterialSet LoadRequired() => new MaterialSet();

            public Material ResolveDistrictBody(DungeonBiomeDistrictKindV2 district) => district switch
            {
                DungeonBiomeDistrictKindV2.Waterworks => WaterworksWall,
                DungeonBiomeDistrictKindV2.MagmaUndercroft => MagmaWall,
                DungeonBiomeDistrictKindV2.ElectricalUndercroft => ElectricalWall,
                _ => FactoryWall
            };

            public Material ResolveDistrictAccent(DungeonBiomeDistrictKindV2 district) => district switch
            {
                DungeonBiomeDistrictKindV2.Waterworks => WaterworksPipes,
                DungeonBiomeDistrictKindV2.MagmaUndercroft => MagmaSurface,
                DungeonBiomeDistrictKindV2.ElectricalUndercroft => ElectricalLive,
                _ => FactoryConduit
            };

            public Material ResolveMachineryAccent(
                IndustrialFactoryV2ModuleDefinition definition,
                CertifiedDungeonSurfaceGeometryV2 surface)
            {
                string profile = surface.MaterialProfileId ?? string.Empty;
                if (profile.IndexOf("coolant", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("pump", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("manifold", StringComparison.OrdinalIgnoreCase) >= 0)
                    return WaterworksPipes;
                if (profile.IndexOf("hazard-processor", StringComparison.OrdinalIgnoreCase) >= 0)
                    return definition.VariantId == IndustrialFactoryV2ModuleCatalog.VariantB
                        ? ElectricalLive
                        : MagmaSurface;
                if (profile.IndexOf("credential", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("surveillance", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("display", StringComparison.OrdinalIgnoreCase) >= 0)
                    return ElectricalLive;
                return FactoryConduit;
            }

            public Material ResolveSurface(
                IndustrialFactoryV2ModuleDefinition definition,
                CertifiedDungeonSurfaceGeometryV2 surface)
            {
                string profile = surface.MaterialProfileId;
                if (surface.Kind == DungeonSurfaceKindV2.SolidOccupancy
                    && profile.StartsWith("machinery-", StringComparison.Ordinal))
                {
                    if (profile.IndexOf("coolant", StringComparison.OrdinalIgnoreCase) >= 0
                        || profile.IndexOf("pump", StringComparison.OrdinalIgnoreCase) >= 0
                        || profile.IndexOf("manifold", StringComparison.OrdinalIgnoreCase) >= 0)
                        return WaterworksPipes;
                    if (profile.IndexOf("hazard-processor", StringComparison.OrdinalIgnoreCase) >= 0)
                        return definition.VariantId == IndustrialFactoryV2ModuleCatalog.VariantB
                            ? ElectricalWall
                            : MagmaWall;
                    return FactoryWall;
                }
                if (surface.Kind == DungeonSurfaceKindV2.Hazard)
                    return definition.CertifiedGeometry.Regions.Any(value =>
                        value.DistrictKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                        ? ElectricalLive
                        : MagmaSurface;
                if (surface.Kind == DungeonSurfaceKindV2.MovingPlatform
                    || surface.Kind == DungeonSurfaceKindV2.Rail)
                    return FactoryCatwalk;
                if (surface.Kind == DungeonSurfaceKindV2.DoorSweep)
                    return FactoryWall;
                if (surface.Kind == DungeonSurfaceKindV2.WaterBed)
                    return WaterworksFloor;
                if (profile.IndexOf("waterworks", StringComparison.OrdinalIgnoreCase) >= 0)
                    return surface.Kind == DungeonSurfaceKindV2.WaterBed ? WaterworksFloor : WaterworksWall;
                if (profile.IndexOf("hazard", StringComparison.OrdinalIgnoreCase) >= 0)
                    return definition.CertifiedGeometry.Regions.Any(value =>
                        value.DistrictKind == DungeonBiomeDistrictKindV2.ElectricalUndercroft)
                        ? ElectricalSafe : MagmaSafeDeck;
                if (profile.IndexOf("ceiling", StringComparison.OrdinalIgnoreCase) >= 0) return FactoryCeiling;
                if (profile.IndexOf("underside", StringComparison.OrdinalIgnoreCase) >= 0) return FactoryCeiling;
                if (profile.IndexOf("catwalk", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("ramp", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("crumble", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("moving", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("reward", StringComparison.OrdinalIgnoreCase) >= 0)
                    return FactoryCatwalk;
                if (profile.IndexOf("wall", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("bulkhead", StringComparison.OrdinalIgnoreCase) >= 0
                    || profile.IndexOf("support", StringComparison.OrdinalIgnoreCase) >= 0)
                    return FactoryWall;
                return FactoryFloor;
            }

            private static Material Load(string name)
            {
                string path = Root + name + ".mat";
                Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (material == null) throw new InvalidOperationException("Missing semantic material " + path + ".");
                return material;
            }
        }
    }
}
