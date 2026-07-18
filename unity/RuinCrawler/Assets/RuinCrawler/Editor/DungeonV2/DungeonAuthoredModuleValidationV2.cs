using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    public enum DungeonAuthoredModuleIssueCodeV2
    {
        CertifiedGeometry,
        MissingHierarchy,
        InvalidHierarchy,
        UnsealedBoundary,
        InvalidInternalPortal,
        InvalidRootScale,
        ColliderOutsideCertifiedGeometry,
        RendererOutsidePresentation,
        RuntimeBindingHasPhysicalContent,
        DuplicateRuntimeBinding,
        InvalidRuntimeBinding,
        MissingPresentation,
        MissingMesh,
        MissingMaterial,
        DefaultMaterial,
        MissingShader,
        MissingTexture,
        MissingUv,
        MissingComposition,
        MissingGenerationDescriptor,
        InvalidCertifiedMarkerHierarchy,
        InvalidConnectorCap,
        UnmappedSolidOccupancy,
        MissingSemanticFeature,
        MissingPlatformPurpose,
        UnsupportedPlatform,
        InvalidPlatformTarget,
        MissingStructuralSupport,
        MissingMechanism,
        MissingStoryVignette,
        MissingLightingProfile,
        InvalidLightingBudget,
        MissingPropProfile
    }

    public sealed class DungeonAuthoredModuleIssueV2
    {
        public DungeonAuthoredModuleIssueV2(
            DungeonAuthoredModuleIssueCodeV2 code,
            string objectPath,
            string message)
        {
            Code = code;
            ObjectPath = objectPath ?? string.Empty;
            Message = message ?? string.Empty;
        }

        public DungeonAuthoredModuleIssueCodeV2 Code { get; }
        public string ObjectPath { get; }
        public string Message { get; }
        public override string ToString() => Code
            + (string.IsNullOrEmpty(ObjectPath) ? string.Empty : " at " + ObjectPath)
            + ": " + Message;
    }

    public sealed class DungeonAuthoredModuleValidationResultV2
    {
        public DungeonAuthoredModuleValidationResultV2(
            CertifiedDungeonModuleGeometryV2 geometry,
            IEnumerable<DungeonAuthoredModuleIssueV2> issues)
        {
            Geometry = geometry;
            Issues = Array.AsReadOnly((issues ?? Array.Empty<DungeonAuthoredModuleIssueV2>()).ToArray());
        }

        public CertifiedDungeonModuleGeometryV2 Geometry { get; }
        public IReadOnlyList<DungeonAuthoredModuleIssueV2> Issues { get; }
        public bool IsValid => Geometry != null && Issues.Count == 0;
    }

    public static class DungeonAuthoredModuleValidatorV2
    {
        public static DungeonAuthoredModuleValidationResultV2 Validate(
            GameObject moduleRoot,
            bool requireCurrentBake = true)
        {
            if (moduleRoot == null) throw new ArgumentNullException(nameof(moduleRoot));
            var issues = new List<DungeonAuthoredModuleIssueV2>();
            DungeonModuleGeometryAuthoringV2 authoring =
                moduleRoot.GetComponent<DungeonModuleGeometryAuthoringV2>();
            if (authoring == null)
            {
                issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingHierarchy,
                    moduleRoot.transform,
                    "Prefab root requires DungeonModuleGeometryAuthoringV2."));
                return new DungeonAuthoredModuleValidationResultV2(null, issues);
            }

            if (!authoring.HasAuthoredHierarchy(out string hierarchyError))
            {
                DungeonAuthoredModuleIssueCodeV2 code = moduleRoot.transform.localScale != Vector3.one
                    ? DungeonAuthoredModuleIssueCodeV2.InvalidRootScale
                    : DungeonAuthoredModuleIssueCodeV2.MissingHierarchy;
                issues.Add(Issue(code, moduleRoot.transform, hierarchyError));
            }

            DungeonCertifiedGeometryBakeResultV2 geometryResult = requireCurrentBake
                ? DungeonCertifiedGeometryBakerV2.ValidateCurrentBake(moduleRoot)
                : DungeonCertifiedGeometryBakerV2.Bake(moduleRoot);
            foreach (DungeonCertifiedGeometryIssueV2 geometryIssue in geometryResult.Issues)
            {
                issues.Add(new DungeonAuthoredModuleIssueV2(
                    DungeonAuthoredModuleIssueCodeV2.CertifiedGeometry,
                    geometryIssue.ObjectPath,
                    geometryIssue.ToString()));
            }

            if (authoring.CertifiedGeometryRoot != null
                && authoring.PresentationRoot != null
                && authoring.RuntimeBindingsRoot != null)
            {
                ValidateHierarchyOwnership(authoring, issues);
                ValidatePresentation(authoring, issues);
                ValidateBindings(authoring, issues);
                ValidateComposition(authoring, issues);
                if (geometryResult.IsValid)
                    ValidateEnclosure(authoring, geometryResult.Geometry, issues);
            }

            return new DungeonAuthoredModuleValidationResultV2(
                geometryResult.IsValid ? geometryResult.Geometry : null,
                issues);
        }

        private static void ValidateHierarchyOwnership(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            foreach (Collider collider in authoring.GetComponentsInChildren<Collider>(true))
            {
                if (!IsWithin(collider.transform, authoring.CertifiedGeometryRoot))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.ColliderOutsideCertifiedGeometry,
                        collider.transform,
                        "All colliders, including trigger volumes, belong under CertifiedGeometry; runtime helpers are created at assembly."));
                }
            }

            ValidateCertifiedMarkerRoots<DungeonRegionGeometryAuthoringV2>(authoring, issues);
            ValidateCertifiedMarkerRoots<DungeonSurfaceGeometryAuthoringV2>(authoring, issues);
            ValidateCertifiedMarkerRoots<DungeonAnchorGeometryAuthoringV2>(authoring, issues);
            ValidateCertifiedMarkerRoots<DungeonConnectorGeometryAuthoringV2>(authoring, issues);

            foreach (DungeonConnectorGeometryAuthoringV2 connector in
                authoring.CertifiedGeometryRoot.GetComponentsInChildren<DungeonConnectorGeometryAuthoringV2>(true))
            {
                if (connector.CapState != DungeonConnectorCapStateV2.PermanentlyOpen
                    && connector.ThemedCapPrefab == null)
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidConnectorCap,
                        connector.transform,
                        "Every closable or unused connector requires an authored themed cap prefab."));
                }
                else if (connector.ThemedCapPrefab != null
                    && connector.ThemedCapPrefab.GetComponentsInChildren<Renderer>(true).Length == 0)
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidConnectorCap,
                        connector.transform,
                        "Themed connector cap prefab has no presentation renderer."));
                }
                else if (connector.ThemedCapPrefab != null
                    && !HasBlockingCapCollider(connector))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidConnectorCap,
                        connector.transform,
                        "Themed connector cap requires a non-trigger blocking collider that covers the exact certified aperture and intersects both player and camera clearance depth."));
                }
            }

            foreach (Renderer renderer in authoring.GetComponentsInChildren<Renderer>(true))
            {
                if (!IsWithin(renderer.transform, authoring.PresentationRoot))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.RendererOutsidePresentation,
                        renderer.transform,
                        "Every authored renderer must belong under Presentation."));
                }
            }

            if (authoring.RuntimeBindingsRoot.GetComponentsInChildren<Collider>(true).Length > 0
                || authoring.RuntimeBindingsRoot.GetComponentsInChildren<Renderer>(true).Length > 0)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.RuntimeBindingHasPhysicalContent,
                    authoring.RuntimeBindingsRoot,
                    "RuntimeBindings must contain markers only, never visible or colliding content."));
            }
        }

        private static void ValidatePresentation(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            Renderer[] renderers = authoring.PresentationRoot.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingPresentation,
                    authoring.PresentationRoot,
                    "An authored module must contain visible presentation geometry."));
                return;
            }

            foreach (Renderer renderer in renderers)
            {
                bool authoredText = renderer.GetComponent<TextMesh>() != null;
                Mesh mesh = ResolveMesh(renderer);
                if (!authoredText && (mesh == null || mesh.vertexCount == 0))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.MissingMesh,
                        renderer.transform,
                        "Renderer has no valid mesh."));
                }

                Material[] materials = renderer.sharedMaterials;
                if (materials == null || materials.Length == 0 || materials.Any(value => value == null))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.MissingMaterial,
                        renderer.transform,
                        "Renderer has a missing material slot."));
                    continue;
                }

                bool worldSpaceApproved = renderer.GetComponent<DungeonWorldSpaceTextureApprovalV2>() != null;
                foreach (Material material in materials)
                {
                    string materialPath = AssetDatabase.GetAssetPath(material);
                    if (!authoredText && (string.IsNullOrWhiteSpace(materialPath)
                        || material.name.IndexOf("Default", StringComparison.OrdinalIgnoreCase) >= 0)
                    )
                    {
                        issues.Add(Issue(
                            DungeonAuthoredModuleIssueCodeV2.DefaultMaterial,
                            renderer.transform,
                            "Runtime/default/transient materials are prohibited; use a shared authored material asset."));
                    }

                    if (material.shader == null
                        || string.Equals(material.shader.name, "Hidden/InternalErrorShader", StringComparison.Ordinal))
                    {
                        issues.Add(Issue(
                            DungeonAuthoredModuleIssueCodeV2.MissingShader,
                            renderer.transform,
                            "Material shader is missing or failed to compile."));
                    }

                    if (!HasTexture(material) && !worldSpaceApproved && !authoredText)
                    {
                        issues.Add(Issue(
                            DungeonAuthoredModuleIssueCodeV2.MissingTexture,
                            renderer.transform,
                            "Every reachable-visible material needs a texture, or an explicit world-space texture approval marker."));
                    }
                }

                if (!authoredText
                    && mesh != null
                    && mesh.vertexCount > 0
                    && (mesh.uv == null || mesh.uv.Length != mesh.vertexCount)
                    && !worldSpaceApproved)
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.MissingUv,
                        renderer.transform,
                        "Mesh is missing complete UV0 and is not approved for world-space mapping."));
                }
            }
        }

        private static void ValidateBindings(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (DungeonRuntimeBindingAuthoringV2 binding in
                authoring.RuntimeBindingsRoot.GetComponentsInChildren<DungeonRuntimeBindingAuthoringV2>(true))
            {
                if (string.IsNullOrWhiteSpace(binding.StableId)
                    || string.IsNullOrWhiteSpace(binding.LocalRegionId)
                    || binding.Target == null
                    || !IsWithin(binding.Target.transform, authoring.transform))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidRuntimeBinding,
                        binding.transform,
                        "Runtime binding IDs and in-prefab target are required."));
                }

                if (!keys.Add(binding.Key))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.DuplicateRuntimeBinding,
                        binding.transform,
                        "Runtime binding key '" + binding.Key + "' is duplicated."));
                }
            }

            ValidateSolidOccupancyPresentation(authoring, issues);
        }

        private static void ValidateSolidOccupancyPresentation(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            DungeonRuntimeBindingAuthoringV2[] bindings = authoring.RuntimeBindingsRoot
                .GetComponentsInChildren<DungeonRuntimeBindingAuthoringV2>(true);
            foreach (DungeonSurfaceGeometryAuthoringV2 occupancy in authoring.CertifiedGeometryRoot
                .GetComponentsInChildren<DungeonSurfaceGeometryAuthoringV2>(true)
                .Where(value => value.Kind == DungeonSurfaceKindV2.SolidOccupancy))
            {
                DungeonRuntimeBindingAuthoringV2 binding = bindings.FirstOrDefault(value =>
                    value.Kind == DungeonRuntimeBindingKindV2.Surface
                    && string.Equals(value.StableId, occupancy.StableId, StringComparison.Ordinal)
                    && string.Equals(value.LocalRegionId, occupancy.RegionId, StringComparison.Ordinal));
                Renderer[] renderers = binding?.Target != null
                    ? binding.Target.GetComponentsInChildren<Renderer>(true)
                    : Array.Empty<Renderer>();
                Collider collider = occupancy.GetComponent<Collider>();
                if (binding == null
                    || binding.Target == null
                    || !IsWithin(binding.Target.transform, authoring.PresentationRoot)
                    || collider == null
                    || renderers.Length == 0
                    || !TryCombinedRendererBounds(renderers, out Bounds rendererBounds)
                    || !BoundsEquivalent(collider.bounds, rendererBounds, 0.025f))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.UnmappedSolidOccupancy,
                        occupancy.transform,
                        "Every certified SolidOccupancy surface requires a same-ID Presentation surface binding whose rendered bounds match the certified collider within 0.025 metres."));
                }
            }
        }

        private static void ValidateComposition(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            DungeonModuleCompositionAuthoringV2 composition =
                authoring.GetComponent<DungeonModuleCompositionAuthoringV2>();
            DungeonModuleGenerationAuthoringV2 generation =
                authoring.GetComponent<DungeonModuleGenerationAuthoringV2>();
            if (generation == null)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingGenerationDescriptor,
                    authoring.transform,
                    "Prefab root requires DungeonModuleGenerationAuthoringV2 so its pure descriptor can be compiled."));
            }
            if (composition == null)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingComposition,
                    authoring.transform,
                    "Prefab root requires DungeonModuleCompositionAuthoringV2."));
                return;
            }

            if (!string.Equals(authoring.DescriptorId, "descriptor-" + authoring.TemplateId, StringComparison.Ordinal)
                || !string.Equals(authoring.ArchetypeId, composition.Archetype.ToString(), StringComparison.Ordinal)
                || !string.Equals(authoring.CompositionContractId, composition.CompositionId, StringComparison.Ordinal))
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingComposition,
                    composition.transform,
                    "Root descriptor/archetype/composition IDs do not match the immutable Core identity."));
            }

            try
            {
                composition.ToCore();
            }
            catch (Exception exception)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingComposition,
                    composition.transform,
                    exception.Message));
            }

            int regionCount = authoring.CertifiedGeometryRoot
                .GetComponentsInChildren<DungeonRegionGeometryAuthoringV2>(true).Length;
            if (regionCount < composition.MinimumRegions)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.MissingComposition,
                    composition.transform,
                    "Composition requires at least " + composition.MinimumRegions
                        + " certified regions; found " + regionCount + "."));
            }

            var features = new HashSet<DungeonModuleSemanticFeatureV2>(
                authoring.PresentationRoot.GetComponentsInChildren<DungeonSemanticFeatureAuthoringV2>(true)
                    .Select(value => value.Feature));
            foreach (DungeonModuleSemanticFeatureV2 required in composition.RequiredSemanticFeatures)
                if (!features.Contains(required))
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingSemanticFeature,
                        composition.transform, "Missing semantic feature " + required + "."));

            DungeonPlatformPurposeAuthoringV2[] platforms = authoring.PresentationRoot
                .GetComponentsInChildren<DungeonPlatformPurposeAuthoringV2>(true);
            var purposes = new HashSet<DungeonPlatformPurposeV2>(platforms.Select(value => value.Purpose));
            foreach (DungeonPlatformPurposeV2 required in composition.RequiredPlatformPurposes)
                if (!purposes.Contains(required))
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingPlatformPurpose,
                        composition.transform, "Missing platform purpose " + required + "."));
            foreach (DungeonPlatformPurposeAuthoringV2 platform in platforms)
            {
                if (string.IsNullOrWhiteSpace(platform.StableId) || platform.Supports.Count == 0
                    || platform.Supports.Any(value => value == null
                        || !IsWithin(value.transform, authoring.PresentationRoot)))
                {
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.UnsupportedPlatform,
                        platform.transform,
                        "Every declared traversable platform needs a stable ID and visible in-module supports."));
                }

                bool observationOnly = platform.Purpose == DungeonPlatformPurposeV2.ObservationOnly;
                if (platform.CertifiedSurface == null
                    || !IsWithin(platform.CertifiedSurface.transform, authoring.CertifiedGeometryRoot)
                    || (observationOnly && platform.CertifiedSurface.IsWalkable)
                    || (!observationOnly && !platform.CertifiedSurface.IsWalkable)
                    || (observationOnly && !string.IsNullOrWhiteSpace(platform.TargetBindingId))
                    || (!observationOnly && string.IsNullOrWhiteSpace(platform.TargetBindingId)))
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidPlatformTarget,
                        platform.transform,
                        observationOnly
                            ? "ObservationOnly must bind a certified non-walkable surface and no gameplay target."
                            : "Traversable platforms must bind a certified walkable surface and stable gameplay target ID."));
                }
                try
                {
                    platform.ToCore();
                }
                catch (Exception exception)
                {
                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.InvalidPlatformTarget,
                        platform.transform,
                        exception.Message));
                }
            }

            var supports = new HashSet<DungeonStructuralSupportKindV2>(
                authoring.PresentationRoot.GetComponentsInChildren<DungeonStructuralSupportAuthoringV2>(true)
                    .Select(value => value.Kind));
            foreach (DungeonStructuralSupportKindV2 required in composition.RequiredSupports)
                if (!supports.Contains(required))
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingStructuralSupport,
                        composition.transform, "Missing structural support " + required + "."));

            var mechanisms = new HashSet<DungeonMechanismProfileV2>(
                authoring.PresentationRoot.GetComponentsInChildren<DungeonMechanismAuthoringV2>(true)
                    .Select(value => value.Profile));
            foreach (DungeonMechanismProfileV2 required in composition.MechanismProfiles)
                if (required != DungeonMechanismProfileV2.None && !mechanisms.Contains(required))
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingMechanism,
                        composition.transform, "Missing mechanism " + required + "."));

            if (!authoring.PresentationRoot.GetComponentsInChildren<DungeonStoryVignetteAuthoringV2>(true)
                    .Any(value => value.Profile == composition.StoryVignette))
                issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingStoryVignette,
                    composition.transform, "Missing story vignette " + composition.StoryVignette + "."));

            DungeonLightingRigAuthoringV2[] rigs = authoring.PresentationRoot
                .GetComponentsInChildren<DungeonLightingRigAuthoringV2>(true);
            foreach (DungeonLightingProfileV2 required in composition.LightingProfiles)
                if (!rigs.Any(value => value.Profile == required))
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingLightingProfile,
                        composition.transform, "Missing lighting profile " + required + "."));
            foreach (DungeonLightingRigAuthoringV2 rig in rigs)
                if (rig.MaximumActivePixelLights > 4 || rig.MaximumShadowedLights > 1)
                    issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.InvalidLightingBudget,
                        rig.transform, "Lighting rig exceeds 4 pixel lights or 1 shadowed light."));

            if (!authoring.PresentationRoot.GetComponentsInChildren<DungeonPropProfileAuthoringV2>(true)
                    .Any(value => value.Profile == composition.PropProfile))
                issues.Add(Issue(DungeonAuthoredModuleIssueCodeV2.MissingPropProfile,
                    composition.transform, "Missing prop profile " + composition.PropProfile + "."));
        }

        private const double EnclosureTolerance = 1e-5d;
        private const double EnclosureProbeOffset = 0.02d;
        private const double MinimumShaftWallDepth = 0.75d;

        /// <summary>
        /// Proves the authored shell from immutable certified geometry. Every
        /// deterministic boundary cell must be occupied by a structural prism,
        /// an exact connector aperture, or a declared topology neighbour. The
        /// coordinate-cell decomposition includes every certified edge, so an
        /// axis-aligned hole cannot fall between arbitrary sample intervals.
        /// </summary>
        private static void ValidateEnclosure(
            DungeonModuleGeometryAuthoringV2 authoring,
            CertifiedDungeonModuleGeometryV2 geometry,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            DungeonModuleGenerationAuthoringV2 generation =
                authoring.GetComponent<DungeonModuleGenerationAuthoringV2>();
            if (geometry == null || generation == null) return;
            DungeonAuthoredModuleTopologyEdgeV2[] topology = generation.ToCoreEdges();

            foreach (CertifiedDungeonRegionGeometryV2 region in geometry.Regions
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                foreach (BoundaryFaceV2 face in BoundaryFaceV2.For(region))
                {
                    ValidateBoundaryFace(authoring, geometry, topology, face, issues);
                }
            }

            ValidateVerticalPortals(authoring, geometry, topology, issues);
        }

        private static void ValidateBoundaryFace(
            DungeonModuleGeometryAuthoringV2 authoring,
            CertifiedDungeonModuleGeometryV2 geometry,
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> topology,
            BoundaryFaceV2 face,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            var uBreaks = new List<double> { face.MinimumU, face.MaximumU };
            var vBreaks = new List<double> { face.MinimumV, face.MaximumV };
            foreach (CertifiedDungeonSurfaceGeometryV2 surface in geometry.Surfaces
                .Where(value => value.IsStructural))
            {
                AddPrismBreaks(face, surface.Volume, uBreaks, vBreaks);
            }
            foreach (CertifiedDungeonConnectorGeometryV2 connector in geometry.Connectors
                .Where(value => string.Equals(value.RegionId, face.Region.Id, StringComparison.Ordinal)))
            {
                AddPrismBreaks(face, connector.Aperture.LocalVolume, uBreaks, vBreaks);
            }
            foreach (CertifiedDungeonRegionGeometryV2 other in geometry.Regions
                .Where(value => !ReferenceEquals(value, face.Region)))
            {
                AddBoundsBreaks(face, other.Bounds, uBreaks, vBreaks);
            }

            double[] orderedU = CanonicalBreaks(uBreaks, face.MinimumU, face.MaximumU);
            double[] orderedV = CanonicalBreaks(vBreaks, face.MinimumV, face.MaximumV);
            for (int uIndex = 0; uIndex < orderedU.Length - 1; uIndex += 1)
            {
                for (int vIndex = 0; vIndex < orderedV.Length - 1; vIndex += 1)
                {
                    double minimumU = orderedU[uIndex];
                    double maximumU = orderedU[uIndex + 1];
                    double minimumV = orderedV[vIndex];
                    double maximumV = orderedV[vIndex + 1];
                    if (maximumU - minimumU <= EnclosureTolerance
                        || maximumV - minimumV <= EnclosureTolerance)
                        continue;

                    if (CellIsCovered(
                        face,
                        minimumU,
                        maximumU,
                        minimumV,
                        maximumV,
                        point => IsBoundaryPointCovered(geometry, topology, face, point)))
                        continue;

                    issues.Add(Issue(
                        DungeonAuthoredModuleIssueCodeV2.UnsealedBoundary,
                        authoring.CertifiedGeometryRoot,
                        "Region '" + face.Region.Id + "' has an uncovered " + face.Kind
                            + " boundary cell U[" + Number(minimumU) + "," + Number(maximumU)
                            + "] V[" + Number(minimumV) + "," + Number(maximumV)
                            + "]. Seal it with certified structural geometry, an exact socket aperture,"
                            + " or a declared internal topology portal."));
                    return;
                }
            }
        }

        private static bool IsBoundaryPointCovered(
            CertifiedDungeonModuleGeometryV2 geometry,
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> topology,
            BoundaryFaceV2 face,
            DungeonPoint3 point)
        {
            if (geometry.Surfaces.Any(value => value.IsStructural
                && Contains(value.Volume, point, EnclosureTolerance)))
                return true;

            if (geometry.Connectors.Any(value =>
                string.Equals(value.RegionId, face.Region.Id, StringComparison.Ordinal)
                && Contains(value.Aperture.LocalVolume, point, EnclosureTolerance)))
                return true;

            DungeonPoint3 outside = Offset(point, face.Normal, EnclosureProbeOffset);
            return geometry.Regions.Any(other =>
                !ReferenceEquals(other, face.Region)
                && AreConnected(topology, face.Region.Id, other.Id)
                && other.Bounds.Contains(outside, EnclosureTolerance));
        }

        private static void ValidateVerticalPortals(
            DungeonModuleGeometryAuthoringV2 authoring,
            CertifiedDungeonModuleGeometryV2 geometry,
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> topology,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            CertifiedDungeonRegionGeometryV2[] regions = geometry.Regions
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToArray();
            for (int lowerIndex = 0; lowerIndex < regions.Length; lowerIndex += 1)
            {
                for (int upperIndex = 0; upperIndex < regions.Length; upperIndex += 1)
                {
                    if (lowerIndex == upperIndex) continue;
                    CertifiedDungeonRegionGeometryV2 lower = regions[lowerIndex];
                    CertifiedDungeonRegionGeometryV2 upper = regions[upperIndex];
                    double interfaceY = lower.Bounds.Maximum.Y;
                    if (Math.Abs(interfaceY - upper.Bounds.Minimum.Y) > EnclosureTolerance)
                        continue;

                    double minimumX = Math.Max(lower.Bounds.Minimum.X, upper.Bounds.Minimum.X);
                    double maximumX = Math.Min(lower.Bounds.Maximum.X, upper.Bounds.Maximum.X);
                    double minimumZ = Math.Max(lower.Bounds.Minimum.Z, upper.Bounds.Minimum.Z);
                    double maximumZ = Math.Min(lower.Bounds.Maximum.Z, upper.Bounds.Maximum.Z);
                    if (maximumX - minimumX <= EnclosureTolerance
                        || maximumZ - minimumZ <= EnclosureTolerance)
                        continue;

                    ValidateVerticalPortal(
                        authoring,
                        geometry,
                        topology,
                        lower,
                        upper,
                        interfaceY,
                        minimumX,
                        maximumX,
                        minimumZ,
                        maximumZ,
                        issues);
                }
            }
        }

        private static void ValidateVerticalPortal(
            DungeonModuleGeometryAuthoringV2 authoring,
            CertifiedDungeonModuleGeometryV2 geometry,
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> topology,
            CertifiedDungeonRegionGeometryV2 lower,
            CertifiedDungeonRegionGeometryV2 upper,
            double interfaceY,
            double minimumX,
            double maximumX,
            double minimumZ,
            double maximumZ,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
        {
            var face = BoundaryFaceV2.Horizontal(
                lower,
                BoundaryFaceKindV2.MaximumY,
                interfaceY,
                minimumX,
                maximumX,
                minimumZ,
                maximumZ,
                new DungeonPoint3(0d, 1d, 0d));
            var xBreaks = new List<double> { minimumX, maximumX };
            var zBreaks = new List<double> { minimumZ, maximumZ };
            foreach (CertifiedDungeonSurfaceGeometryV2 surface in geometry.Surfaces
                .Where(value => value.IsStructural))
            {
                AddPrismBreaks(face, surface.Volume, xBreaks, zBreaks);
            }
            double[] orderedX = CanonicalBreaks(xBreaks, minimumX, maximumX);
            double[] orderedZ = CanonicalBreaks(zBreaks, minimumZ, maximumZ);
            var openings = new List<PortalCellV2>();
            double sharedArea = (maximumX - minimumX) * (maximumZ - minimumZ);
            for (int xIndex = 0; xIndex < orderedX.Length - 1; xIndex += 1)
            {
                for (int zIndex = 0; zIndex < orderedZ.Length - 1; zIndex += 1)
                {
                    double x0 = orderedX[xIndex];
                    double x1 = orderedX[xIndex + 1];
                    double z0 = orderedZ[zIndex];
                    double z1 = orderedZ[zIndex + 1];
                    if (x1 - x0 <= EnclosureTolerance || z1 - z0 <= EnclosureTolerance)
                        continue;
                    bool sealedCell = CellIsCovered(
                        face,
                        x0,
                        x1,
                        z0,
                        z1,
                        point => geometry.Surfaces.Any(value => value.IsStructural
                            && Contains(value.Volume, point, EnclosureTolerance)));
                    if (!sealedCell) openings.Add(new PortalCellV2(x0, x1, z0, z1));
                }
            }
            if (openings.Count == 0) return;

            DungeonAuthoredModuleTopologyEdgeV2 edge = topology.FirstOrDefault(value =>
                Connects(value, lower.Id, upper.Id));
            if (edge == null)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.InvalidInternalPortal,
                    authoring.CertifiedGeometryRoot,
                    "Regions '" + lower.Id + "' and '" + upper.Id
                        + "' share an open vertical interface without a topology edge."));
                return;
            }

            double openMinimumX = openings.Min(value => value.MinimumX);
            double openMaximumX = openings.Max(value => value.MaximumX);
            double openMinimumZ = openings.Min(value => value.MinimumZ);
            double openMaximumZ = openings.Max(value => value.MaximumZ);
            double openArea = openings.Sum(value => value.Area);
            bool bounded = openMinimumX > minimumX + EnclosureTolerance
                && openMaximumX < maximumX - EnclosureTolerance
                && openMinimumZ > minimumZ + EnclosureTolerance
                && openMaximumZ < maximumZ - EnclosureTolerance;
            if (!bounded || openArea > sharedArea * 0.35d)
            {
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.InvalidInternalPortal,
                    authoring.CertifiedGeometryRoot,
                    "Vertical portal '" + lower.Id + "' -> '" + upper.Id
                        + "' must be a bounded authored aperture covering at most 35% of the shared face;"
                        + " open area is " + Number(openArea) + " of " + Number(sharedArea) + "."));
                return;
            }

            bool returnRoute = edge.Bidirectional || geometry.Anchors.Any(value =>
                string.Equals(value.RegionId, lower.Id, StringComparison.Ordinal)
                && (value.Kind == DungeonAnchorKindV2.Exit
                    || value.Kind == DungeonAnchorKindV2.ShortcutActivation
                    || (value.Kind == DungeonAnchorKindV2.Console
                        && ContainsAny(value.ProfileId, "return", "lift", "route"))));
            bool safeCatchment = geometry.Surfaces.Any(value => value.IsStructural
                && value.IsWalkable
                && value.Kind != DungeonSurfaceKindV2.Hazard
                && string.Equals(value.RegionId, lower.Id, StringComparison.Ordinal)
                && value.Volume.MaximumY < interfaceY - EnclosureTolerance
                && ContainsHorizontal(
                    value.Volume,
                    (openMinimumX + openMaximumX) * 0.5d,
                    (openMinimumZ + openMaximumZ) * 0.5d,
                    EnclosureTolerance));
            bool shaftWalls = HasShaftWalls(
                geometry.Surfaces,
                interfaceY,
                openMinimumX,
                openMaximumX,
                openMinimumZ,
                openMaximumZ);
            if (returnRoute && safeCatchment && shaftWalls) return;

            var missing = new List<string>();
            if (!shaftWalls) missing.Add("four continuous certified shaft walls");
            if (!safeCatchment) missing.Add("a damage-free certified lower landing/catchment");
            if (!returnRoute) missing.Add("a bidirectional or explicit return route");
            issues.Add(Issue(
                DungeonAuthoredModuleIssueCodeV2.InvalidInternalPortal,
                authoring.CertifiedGeometryRoot,
                "Vertical portal '" + lower.Id + "' -> '" + upper.Id
                    + "' is missing " + string.Join(", ", missing) + "."));
        }

        private static bool HasShaftWalls(
            IReadOnlyList<CertifiedDungeonSurfaceGeometryV2> surfaces,
            double interfaceY,
            double minimumX,
            double maximumX,
            double minimumZ,
            double maximumZ)
        {
            bool west = false;
            bool east = false;
            bool south = false;
            bool north = false;
            foreach (CertifiedDungeonSurfaceGeometryV2 surface in surfaces.Where(value => value.IsStructural))
            {
                DungeonConvexPrismV2 volume = surface.Volume;
                if (volume.MinimumY > interfaceY - MinimumShaftWallDepth + EnclosureTolerance
                    || volume.MaximumY < interfaceY - EnclosureTolerance)
                    continue;
                PrismHorizontalBounds(volume, out double x0, out double x1, out double z0, out double z1);
                if (x0 <= minimumX + EnclosureTolerance && x1 >= minimumX - EnclosureTolerance
                    && z0 <= minimumZ + EnclosureTolerance && z1 >= maximumZ - EnclosureTolerance)
                    west = true;
                if (x0 <= maximumX + EnclosureTolerance && x1 >= maximumX - EnclosureTolerance
                    && z0 <= minimumZ + EnclosureTolerance && z1 >= maximumZ - EnclosureTolerance)
                    east = true;
                if (z0 <= minimumZ + EnclosureTolerance && z1 >= minimumZ - EnclosureTolerance
                    && x0 <= minimumX + EnclosureTolerance && x1 >= maximumX - EnclosureTolerance)
                    south = true;
                if (z0 <= maximumZ + EnclosureTolerance && z1 >= maximumZ - EnclosureTolerance
                    && x0 <= minimumX + EnclosureTolerance && x1 >= maximumX - EnclosureTolerance)
                    north = true;
            }
            return west && east && south && north;
        }

        private static bool CellIsCovered(
            BoundaryFaceV2 face,
            double minimumU,
            double maximumU,
            double minimumV,
            double maximumV,
            Func<DungeonPoint3, bool> predicate)
        {
            double[] fractions = { 0.2d, 0.5d, 0.8d };
            foreach (double uFraction in fractions)
            {
                foreach (double vFraction in fractions)
                {
                    DungeonPoint3 point = face.Point(
                        minimumU + (maximumU - minimumU) * uFraction,
                        minimumV + (maximumV - minimumV) * vFraction);
                    if (!predicate(point)) return false;
                }
            }
            return true;
        }

        private static bool AreConnected(
            IReadOnlyList<DungeonAuthoredModuleTopologyEdgeV2> edges,
            string left,
            string right) => edges.Any(value => Connects(value, left, right));

        private static bool Connects(
            DungeonAuthoredModuleTopologyEdgeV2 edge,
            string left,
            string right) =>
            (string.Equals(edge.FromLocalRegionId, left, StringComparison.Ordinal)
                && string.Equals(edge.ToLocalRegionId, right, StringComparison.Ordinal))
            || (string.Equals(edge.FromLocalRegionId, right, StringComparison.Ordinal)
                && string.Equals(edge.ToLocalRegionId, left, StringComparison.Ordinal));

        private static bool ContainsAny(string value, params string[] fragments) =>
            !string.IsNullOrWhiteSpace(value)
            && fragments.Any(fragment => value.IndexOf(fragment, StringComparison.OrdinalIgnoreCase) >= 0);

        private static DungeonPoint3 Offset(DungeonPoint3 point, DungeonPoint3 direction, double distance) =>
            new DungeonPoint3(
                point.X + direction.X * distance,
                point.Y + direction.Y * distance,
                point.Z + direction.Z * distance);

        private static bool Contains(
            DungeonConvexPrismV2 prism,
            DungeonPoint3 point,
            double tolerance)
        {
            if (point.Y < prism.MinimumY - tolerance || point.Y > prism.MaximumY + tolerance)
                return false;
            return ContainsHorizontal(prism, point.X, point.Z, tolerance);
        }

        private static bool ContainsHorizontal(
            DungeonConvexPrismV2 prism,
            double x,
            double z,
            double tolerance)
        {
            double sign = 0d;
            for (int index = 0; index < prism.HorizontalVertices.Count; index += 1)
            {
                DungeonPoint2V2 a = prism.HorizontalVertices[index];
                DungeonPoint2V2 b = prism.HorizontalVertices[(index + 1) % prism.HorizontalVertices.Count];
                double cross = (b.X - a.X) * (z - a.Z) - (b.Z - a.Z) * (x - a.X);
                if (Math.Abs(cross) <= tolerance) continue;
                double current = Math.Sign(cross);
                if (sign == 0d) sign = current;
                else if (current != sign) return false;
            }
            return true;
        }

        private static void AddPrismBreaks(
            BoundaryFaceV2 face,
            DungeonConvexPrismV2 prism,
            ICollection<double> uBreaks,
            ICollection<double> vBreaks)
        {
            PrismHorizontalBounds(prism, out double minimumX, out double maximumX,
                out double minimumZ, out double maximumZ);
            double planeMinimum;
            double planeMaximum;
            double minimumU;
            double maximumU;
            double minimumV;
            double maximumV;
            switch (face.Kind)
            {
                case BoundaryFaceKindV2.MinimumX:
                case BoundaryFaceKindV2.MaximumX:
                    planeMinimum = minimumX;
                    planeMaximum = maximumX;
                    minimumU = minimumZ;
                    maximumU = maximumZ;
                    minimumV = prism.MinimumY;
                    maximumV = prism.MaximumY;
                    break;
                case BoundaryFaceKindV2.MinimumZ:
                case BoundaryFaceKindV2.MaximumZ:
                    planeMinimum = minimumZ;
                    planeMaximum = maximumZ;
                    minimumU = minimumX;
                    maximumU = maximumX;
                    minimumV = prism.MinimumY;
                    maximumV = prism.MaximumY;
                    break;
                default:
                    planeMinimum = prism.MinimumY;
                    planeMaximum = prism.MaximumY;
                    minimumU = minimumX;
                    maximumU = maximumX;
                    minimumV = minimumZ;
                    maximumV = maximumZ;
                    break;
            }
            if (face.Plane < planeMinimum - EnclosureTolerance
                || face.Plane > planeMaximum + EnclosureTolerance)
                return;
            AddClampedBreaks(uBreaks, minimumU, maximumU, face.MinimumU, face.MaximumU);
            AddClampedBreaks(vBreaks, minimumV, maximumV, face.MinimumV, face.MaximumV);
        }

        private static void AddBoundsBreaks(
            BoundaryFaceV2 face,
            DungeonBounds3 bounds,
            ICollection<double> uBreaks,
            ICollection<double> vBreaks)
        {
            double planeMinimum;
            double planeMaximum;
            double minimumU;
            double maximumU;
            double minimumV;
            double maximumV;
            switch (face.Kind)
            {
                case BoundaryFaceKindV2.MinimumX:
                case BoundaryFaceKindV2.MaximumX:
                    planeMinimum = bounds.Minimum.X;
                    planeMaximum = bounds.Maximum.X;
                    minimumU = bounds.Minimum.Z;
                    maximumU = bounds.Maximum.Z;
                    minimumV = bounds.Minimum.Y;
                    maximumV = bounds.Maximum.Y;
                    break;
                case BoundaryFaceKindV2.MinimumZ:
                case BoundaryFaceKindV2.MaximumZ:
                    planeMinimum = bounds.Minimum.Z;
                    planeMaximum = bounds.Maximum.Z;
                    minimumU = bounds.Minimum.X;
                    maximumU = bounds.Maximum.X;
                    minimumV = bounds.Minimum.Y;
                    maximumV = bounds.Maximum.Y;
                    break;
                default:
                    planeMinimum = bounds.Minimum.Y;
                    planeMaximum = bounds.Maximum.Y;
                    minimumU = bounds.Minimum.X;
                    maximumU = bounds.Maximum.X;
                    minimumV = bounds.Minimum.Z;
                    maximumV = bounds.Maximum.Z;
                    break;
            }
            if (face.Plane < planeMinimum - EnclosureTolerance
                || face.Plane > planeMaximum + EnclosureTolerance)
                return;
            AddClampedBreaks(uBreaks, minimumU, maximumU, face.MinimumU, face.MaximumU);
            AddClampedBreaks(vBreaks, minimumV, maximumV, face.MinimumV, face.MaximumV);
        }

        private static void AddClampedBreaks(
            ICollection<double> values,
            double minimum,
            double maximum,
            double faceMinimum,
            double faceMaximum)
        {
            double low = Math.Max(minimum, faceMinimum);
            double high = Math.Min(maximum, faceMaximum);
            if (high - low <= EnclosureTolerance) return;
            values.Add(low);
            values.Add(high);
        }

        private static double[] CanonicalBreaks(
            IEnumerable<double> values,
            double minimum,
            double maximum)
        {
            var ordered = new List<double>();
            foreach (double value in values
                .Select(candidate => Math.Max(minimum, Math.Min(maximum, candidate)))
                .OrderBy(candidate => candidate))
            {
                if (ordered.Count == 0
                    || Math.Abs(value - ordered[ordered.Count - 1]) > EnclosureTolerance)
                    ordered.Add(value);
            }
            if (ordered.Count == 0 || ordered[0] > minimum + EnclosureTolerance)
                ordered.Insert(0, minimum);
            if (ordered[ordered.Count - 1] < maximum - EnclosureTolerance)
                ordered.Add(maximum);
            return ordered.ToArray();
        }

        private static void PrismHorizontalBounds(
            DungeonConvexPrismV2 prism,
            out double minimumX,
            out double maximumX,
            out double minimumZ,
            out double maximumZ)
        {
            minimumX = prism.HorizontalVertices.Min(value => value.X);
            maximumX = prism.HorizontalVertices.Max(value => value.X);
            minimumZ = prism.HorizontalVertices.Min(value => value.Z);
            maximumZ = prism.HorizontalVertices.Max(value => value.Z);
        }

        private static string Number(double value) =>
            value.ToString("0.###", CultureInfo.InvariantCulture);

        private enum BoundaryFaceKindV2
        {
            MinimumX,
            MaximumX,
            MinimumY,
            MaximumY,
            MinimumZ,
            MaximumZ
        }

        private readonly struct BoundaryFaceV2
        {
            private BoundaryFaceV2(
                CertifiedDungeonRegionGeometryV2 region,
                BoundaryFaceKindV2 kind,
                double plane,
                double minimumU,
                double maximumU,
                double minimumV,
                double maximumV,
                DungeonPoint3 normal)
            {
                Region = region;
                Kind = kind;
                Plane = plane;
                MinimumU = minimumU;
                MaximumU = maximumU;
                MinimumV = minimumV;
                MaximumV = maximumV;
                Normal = normal;
            }

            public CertifiedDungeonRegionGeometryV2 Region { get; }
            public BoundaryFaceKindV2 Kind { get; }
            public double Plane { get; }
            public double MinimumU { get; }
            public double MaximumU { get; }
            public double MinimumV { get; }
            public double MaximumV { get; }
            public DungeonPoint3 Normal { get; }

            public DungeonPoint3 Point(double u, double v)
            {
                switch (Kind)
                {
                    case BoundaryFaceKindV2.MinimumX:
                    case BoundaryFaceKindV2.MaximumX:
                        return new DungeonPoint3(Plane, v, u);
                    case BoundaryFaceKindV2.MinimumZ:
                    case BoundaryFaceKindV2.MaximumZ:
                        return new DungeonPoint3(u, v, Plane);
                    default:
                        return new DungeonPoint3(u, Plane, v);
                }
            }

            public static BoundaryFaceV2[] For(CertifiedDungeonRegionGeometryV2 region)
            {
                DungeonBounds3 bounds = region.Bounds;
                return new[]
                {
                    new BoundaryFaceV2(region, BoundaryFaceKindV2.MinimumX, bounds.Minimum.X,
                        bounds.Minimum.Z, bounds.Maximum.Z, bounds.Minimum.Y, bounds.Maximum.Y,
                        new DungeonPoint3(-1d, 0d, 0d)),
                    new BoundaryFaceV2(region, BoundaryFaceKindV2.MaximumX, bounds.Maximum.X,
                        bounds.Minimum.Z, bounds.Maximum.Z, bounds.Minimum.Y, bounds.Maximum.Y,
                        new DungeonPoint3(1d, 0d, 0d)),
                    Horizontal(region, BoundaryFaceKindV2.MinimumY, bounds.Minimum.Y,
                        bounds.Minimum.X, bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z,
                        new DungeonPoint3(0d, -1d, 0d)),
                    Horizontal(region, BoundaryFaceKindV2.MaximumY, bounds.Maximum.Y,
                        bounds.Minimum.X, bounds.Maximum.X, bounds.Minimum.Z, bounds.Maximum.Z,
                        new DungeonPoint3(0d, 1d, 0d)),
                    new BoundaryFaceV2(region, BoundaryFaceKindV2.MinimumZ, bounds.Minimum.Z,
                        bounds.Minimum.X, bounds.Maximum.X, bounds.Minimum.Y, bounds.Maximum.Y,
                        new DungeonPoint3(0d, 0d, -1d)),
                    new BoundaryFaceV2(region, BoundaryFaceKindV2.MaximumZ, bounds.Maximum.Z,
                        bounds.Minimum.X, bounds.Maximum.X, bounds.Minimum.Y, bounds.Maximum.Y,
                        new DungeonPoint3(0d, 0d, 1d))
                };
            }

            public static BoundaryFaceV2 Horizontal(
                CertifiedDungeonRegionGeometryV2 region,
                BoundaryFaceKindV2 kind,
                double plane,
                double minimumX,
                double maximumX,
                double minimumZ,
                double maximumZ,
                DungeonPoint3 normal) => new BoundaryFaceV2(
                    region,
                    kind,
                    plane,
                    minimumX,
                    maximumX,
                    minimumZ,
                    maximumZ,
                    normal);
        }

        private readonly struct PortalCellV2
        {
            public PortalCellV2(
                double minimumX,
                double maximumX,
                double minimumZ,
                double maximumZ)
            {
                MinimumX = minimumX;
                MaximumX = maximumX;
                MinimumZ = minimumZ;
                MaximumZ = maximumZ;
            }
            public double MinimumX { get; }
            public double MaximumX { get; }
            public double MinimumZ { get; }
            public double MaximumZ { get; }
            public double Area => (MaximumX - MinimumX) * (MaximumZ - MinimumZ);
        }

        private static bool HasBlockingCapCollider(DungeonConnectorGeometryAuthoringV2 connector)
        {
            GameObject cap = connector.ThemedCapPrefab;
            if (cap == null) return false;

            Vector3 apertureHalf = connector.LocalApertureSize * 0.5f;
            Vector3 apertureMinimum = connector.LocalApertureCenter - apertureHalf;
            Vector3 apertureMaximum = connector.LocalApertureCenter + apertureHalf;
            foreach (Collider collider in cap.GetComponentsInChildren<Collider>(true))
            {
                if (collider == null || !collider.enabled || collider.isTrigger
                    || !TryColliderBoundsInRoot(collider, cap.transform, out Bounds bounds))
                    continue;

                const float tolerance = 0.01f;
                if (bounds.min.x > apertureMinimum.x + tolerance
                    || bounds.max.x < apertureMaximum.x - tolerance
                    || bounds.min.y > apertureMinimum.y + tolerance
                    || bounds.max.y < apertureMaximum.y - tolerance
                    || bounds.min.z > connector.LocalApertureCenter.z + tolerance
                    || bounds.max.z < connector.LocalApertureCenter.z - tolerance)
                    continue;

                if (DepthOverlaps(bounds, connector.LocalPlayerClearanceCenter,
                        connector.LocalPlayerClearanceSize, tolerance)
                    && DepthOverlaps(bounds, connector.LocalCameraClearanceCenter,
                        connector.LocalCameraClearanceSize, tolerance))
                    return true;
            }
            return false;
        }

        private static bool DepthOverlaps(
            Bounds blocker,
            Vector3 clearanceCenter,
            Vector3 clearanceSize,
            float tolerance)
        {
            float minimum = clearanceCenter.z - clearanceSize.z * 0.5f;
            float maximum = clearanceCenter.z + clearanceSize.z * 0.5f;
            return blocker.max.z >= minimum - tolerance
                && blocker.min.z <= maximum + tolerance;
        }

        private static bool TryColliderBoundsInRoot(
            Collider collider,
            Transform root,
            out Bounds bounds)
        {
            Vector3 center;
            Vector3 size;
            switch (collider)
            {
                case BoxCollider box:
                    center = box.center;
                    size = box.size;
                    break;
                case MeshCollider mesh when mesh.sharedMesh != null:
                    center = mesh.sharedMesh.bounds.center;
                    size = mesh.sharedMesh.bounds.size;
                    break;
                case SphereCollider sphere:
                    center = sphere.center;
                    size = Vector3.one * sphere.radius * 2f;
                    break;
                case CapsuleCollider capsule:
                    center = capsule.center;
                    size = Vector3.one * capsule.radius * 2f;
                    size[capsule.direction] = capsule.height;
                    break;
                default:
                    bounds = default;
                    return false;
            }

            Vector3 half = size * 0.5f;
            Vector3 first = root.InverseTransformPoint(collider.transform.TransformPoint(
                center + new Vector3(-half.x, -half.y, -half.z)));
            bounds = new Bounds(first, Vector3.zero);
            for (int x = -1; x <= 1; x += 2)
            for (int y = -1; y <= 1; y += 2)
            for (int z = -1; z <= 1; z += 2)
            {
                Vector3 corner = center + new Vector3(x * half.x, y * half.y, z * half.z);
                bounds.Encapsulate(root.InverseTransformPoint(
                    collider.transform.TransformPoint(corner)));
            }
            return true;
        }

        private static bool TryCombinedRendererBounds(Renderer[] renderers, out Bounds bounds)
        {
            Renderer first = renderers.FirstOrDefault(value => value != null && value.enabled);
            if (first == null)
            {
                bounds = default;
                return false;
            }
            bounds = first.bounds;
            foreach (Renderer renderer in renderers)
                if (renderer != null && renderer.enabled)
                    bounds.Encapsulate(renderer.bounds);
            return true;
        }

        private static bool BoundsEquivalent(Bounds expected, Bounds actual, float tolerance)
        {
            return Mathf.Abs(expected.min.x - actual.min.x) <= tolerance
                && Mathf.Abs(expected.min.y - actual.min.y) <= tolerance
                && Mathf.Abs(expected.min.z - actual.min.z) <= tolerance
                && Mathf.Abs(expected.max.x - actual.max.x) <= tolerance
                && Mathf.Abs(expected.max.y - actual.max.y) <= tolerance
                && Mathf.Abs(expected.max.z - actual.max.z) <= tolerance;
        }

        private static Mesh ResolveMesh(Renderer renderer)
        {
            if (renderer is SkinnedMeshRenderer skinned) return skinned.sharedMesh;
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            return filter != null ? filter.sharedMesh : null;
        }

        private static bool HasTexture(Material material)
        {
            if (material == null || material.shader == null) return false;
            int count = material.shader.GetPropertyCount();
            for (int index = 0; index < count; index += 1)
            {
                if (material.shader.GetPropertyType(index) != UnityEngine.Rendering.ShaderPropertyType.Texture)
                    continue;
                if (material.GetTexture(material.shader.GetPropertyName(index)) != null) return true;
            }
            return false;
        }

        private static bool IsWithin(Transform candidate, Transform root)
        {
            if (candidate == null || root == null) return false;
            return candidate == root || candidate.IsChildOf(root);
        }

        private static void ValidateCertifiedMarkerRoots<T>(
            DungeonModuleGeometryAuthoringV2 authoring,
            ICollection<DungeonAuthoredModuleIssueV2> issues)
            where T : Component
        {
            foreach (T marker in authoring.GetComponentsInChildren<T>(true))
            {
                if (IsWithin(marker.transform, authoring.CertifiedGeometryRoot)) continue;
                issues.Add(Issue(
                    DungeonAuthoredModuleIssueCodeV2.InvalidCertifiedMarkerHierarchy,
                    marker.transform,
                    typeof(T).Name + " belongs under CertifiedGeometry."));
            }
        }

        private static DungeonAuthoredModuleIssueV2 Issue(
            DungeonAuthoredModuleIssueCodeV2 code,
            Transform target,
            string message) => new DungeonAuthoredModuleIssueV2(code, Path(target), message);

        private static string Path(Transform target)
        {
            if (target == null) return string.Empty;
            string result = target.name;
            while (target.parent != null)
            {
                target = target.parent;
                result = target.name + "/" + result;
            }
            return result;
        }
    }

    public static class DungeonAuthoredModuleRevisionUtilityV2
    {
        public static string ComputePresentationDependencyHash(GameObject moduleRoot)
        {
            if (moduleRoot == null) throw new ArgumentNullException(nameof(moduleRoot));
            DungeonModuleGeometryAuthoringV2 authoring =
                moduleRoot.GetComponent<DungeonModuleGeometryAuthoringV2>();
            if (authoring == null || authoring.PresentationRoot == null)
                throw new InvalidOperationException("Authored module presentation root is required.");

            var lines = new List<string>();
            foreach (Transform current in authoring.PresentationRoot.GetComponentsInChildren<Transform>(true)
                .OrderBy(value => RelativePath(authoring.PresentationRoot, value), StringComparer.Ordinal))
            {
                lines.Add("T|" + RelativePath(authoring.PresentationRoot, current)
                    + "|" + Vector(current.localPosition)
                    + "|" + QuaternionValue(current.localRotation)
                    + "|" + Vector(current.localScale)
                    + "|" + current.gameObject.activeSelf);
                foreach (Component component in current.GetComponents<Component>()
                    .Where(value => value != null)
                    .OrderBy(value => value.GetType().FullName, StringComparer.Ordinal))
                {
                    if (component is Transform) continue;
                    lines.Add("C|" + component.GetType().FullName + "|" + AssetIdentity(component));
                    if (component is Renderer renderer)
                    {
                        lines.Add("MESH|" + AssetIdentity(ResolveMesh(renderer)));
                        foreach (Material material in renderer.sharedMaterials)
                            lines.Add("MAT|" + AssetIdentity(material)
                                + "|SHADER|" + (material != null && material.shader != null ? material.shader.name : "missing"));
                    }
                    else if (component is Light light)
                    {
                        lines.Add("LIGHT|" + (int)light.type + "|" + ColorValue(light.color)
                            + "|" + Number(light.intensity) + "|" + Number(light.range)
                            + "|" + (int)light.shadows);
                    }
                }
            }

            foreach (DungeonConnectorGeometryAuthoringV2 connector in
                authoring.CertifiedGeometryRoot.GetComponentsInChildren<DungeonConnectorGeometryAuthoringV2>(true)
                    .OrderBy(value => value.StableId, StringComparer.Ordinal))
            {
                lines.Add("CAP|" + connector.StableId + "|" + connector.ThemedCapProfileId
                    + "|" + AssetIdentity(connector.ThemedCapPrefab));
            }

            return Hash(lines);
        }

        private static string AssetIdentity(UnityEngine.Object value)
        {
            if (value == null) return "null";
            if (AssetDatabase.TryGetGUIDAndLocalFileIdentifier(value, out string guid, out long localId))
            {
                string path = AssetDatabase.GetAssetPath(value);
                string dependencyHash = string.IsNullOrWhiteSpace(path)
                    ? string.Empty
                    : AssetDatabase.GetAssetDependencyHash(path).ToString();
                return guid + ":" + localId.ToString(CultureInfo.InvariantCulture) + ":" + dependencyHash;
            }
            return value.GetType().FullName + ":" + value.name;
        }

        private static Mesh ResolveMesh(Renderer renderer)
        {
            if (renderer is SkinnedMeshRenderer skinned) return skinned.sharedMesh;
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            return filter != null ? filter.sharedMesh : null;
        }

        private static string RelativePath(Transform root, Transform value)
        {
            if (value == root) return root.name;
            var parts = new Stack<string>();
            while (value != null && value != root)
            {
                parts.Push(value.name);
                value = value.parent;
            }
            return root.name + "/" + string.Join("/", parts);
        }

        private static string Vector(Vector3 value) => Number(value.x) + "," + Number(value.y) + "," + Number(value.z);
        private static string QuaternionValue(Quaternion value) => Number(value.x) + "," + Number(value.y) + "," + Number(value.z) + "," + Number(value.w);
        private static string ColorValue(Color value) => Number(value.r) + "," + Number(value.g) + "," + Number(value.b) + "," + Number(value.a);
        private static string Number(float value) => value.ToString("R", CultureInfo.InvariantCulture);

        private static string Hash(IEnumerable<string> lines)
        {
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] bytes = Encoding.UTF8.GetBytes(string.Join("\n", lines));
                byte[] digest = algorithm.ComputeHash(bytes);
                return "sha256:" + string.Concat(digest.Select(value => value.ToString("x2", CultureInfo.InvariantCulture)));
            }
        }
    }
}
