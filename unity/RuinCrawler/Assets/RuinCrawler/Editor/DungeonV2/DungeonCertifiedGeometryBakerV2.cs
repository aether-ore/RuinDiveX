using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Dungeon;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    public enum DungeonCertifiedGeometryIssueCodeV2
    {
        MissingModuleAuthoring,
        MissingRegion,
        UnmarkedCollider,
        MultipleCollidersOnSurface,
        TriggerSurface,
        UnsupportedCollider,
        NonConvexMesh,
        MissingMesh,
        NonPrismaticGeometry,
        InvalidAuthoring,
        GeometryOutsideRegion,
        MissingBake,
        UnsupportedSchema,
        StaleContentHash,
        TemplateMismatch
    }

    public sealed class DungeonCertifiedGeometryIssueV2
    {
        public DungeonCertifiedGeometryIssueV2(
            DungeonCertifiedGeometryIssueCodeV2 code,
            string objectPath,
            string message)
        {
            Code = code;
            ObjectPath = objectPath ?? string.Empty;
            Message = message ?? string.Empty;
        }

        public DungeonCertifiedGeometryIssueCodeV2 Code { get; }
        public string ObjectPath { get; }
        public string Message { get; }

        public override string ToString()
        {
            return Code + (string.IsNullOrEmpty(ObjectPath) ? string.Empty : " at " + ObjectPath) + ": " + Message;
        }
    }

    public sealed class DungeonCertifiedGeometryBakeResultV2
    {
        public DungeonCertifiedGeometryBakeResultV2(
            CertifiedDungeonModuleGeometryV2 geometry,
            IEnumerable<DungeonCertifiedGeometryIssueV2> issues)
        {
            Geometry = geometry;
            Issues = Array.AsReadOnly((issues ?? Array.Empty<DungeonCertifiedGeometryIssueV2>()).ToArray());
        }

        public CertifiedDungeonModuleGeometryV2 Geometry { get; }
        public IReadOnlyList<DungeonCertifiedGeometryIssueV2> Issues { get; }
        public bool IsValid => Geometry != null && Issues.Count == 0;
    }

    public static class DungeonCertifiedGeometryBakerV2
    {
        private const double GeometryTolerance = 0.0001d;

        public static DungeonCertifiedGeometryBakeResultV2 Bake(GameObject moduleRoot)
        {
            if (moduleRoot == null)
            {
                throw new ArgumentNullException(nameof(moduleRoot));
            }

            var issues = new List<DungeonCertifiedGeometryIssueV2>();
            DungeonModuleGeometryAuthoringV2 module = moduleRoot.GetComponent<DungeonModuleGeometryAuthoringV2>();
            if (module == null)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MissingModuleAuthoring,
                    moduleRoot.transform,
                    "The prefab root must own DungeonModuleGeometryAuthoringV2."));
                return new DungeonCertifiedGeometryBakeResultV2(null, issues);
            }

            DungeonRegionGeometryAuthoringV2[] regionMarkers =
                moduleRoot.GetComponentsInChildren<DungeonRegionGeometryAuthoringV2>(true);
            if (regionMarkers.Length == 0)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MissingRegion,
                    moduleRoot.transform,
                    "At least one certified region marker is required."));
            }

            if (module.RequireEveryColliderCertified)
            {
                ValidateColliderOwnership(moduleRoot, issues);
            }

            var regions = new List<CertifiedDungeonRegionGeometryV2>();
            var regionById = new Dictionary<string, CertifiedDungeonRegionGeometryV2>(StringComparer.Ordinal);
            foreach (DungeonRegionGeometryAuthoringV2 marker in regionMarkers)
            {
                try
                {
                    CertifiedDungeonRegionGeometryV2 region = BakeRegion(moduleRoot.transform, marker);
                    regions.Add(region);
                    if (!regionById.TryAdd(region.Id, region))
                    {
                        issues.Add(Issue(
                            DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                            marker.transform,
                            "Duplicate region stable ID '" + region.Id + "'."));
                    }
                }
                catch (Exception exception)
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                        marker.transform,
                        exception.Message));
                }
            }

            var surfaces = new List<CertifiedDungeonSurfaceGeometryV2>();
            foreach (DungeonSurfaceGeometryAuthoringV2 marker in
                moduleRoot.GetComponentsInChildren<DungeonSurfaceGeometryAuthoringV2>(true))
            {
                TryBakeSurface(moduleRoot.transform, marker, regionById, surfaces, issues);
            }

            var anchors = new List<CertifiedDungeonAnchorGeometryV2>();
            foreach (DungeonAnchorGeometryAuthoringV2 marker in
                moduleRoot.GetComponentsInChildren<DungeonAnchorGeometryAuthoringV2>(true))
            {
                try
                {
                    DungeonPoint3 position = ToCorePoint(
                        moduleRoot.transform.InverseTransformPoint(marker.transform.position));
                    var anchor = new CertifiedDungeonAnchorGeometryV2(
                        marker.StableId,
                        marker.RegionId,
                        marker.Kind,
                        position,
                        marker.ProfileId);
                    anchors.Add(anchor);
                    ValidatePointInRegion(anchor.RegionId, anchor.Position, marker.transform, regionById, issues);
                }
                catch (Exception exception)
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                        marker.transform,
                        exception.Message));
                }
            }

            var connectors = new List<CertifiedDungeonConnectorGeometryV2>();
            foreach (DungeonConnectorGeometryAuthoringV2 marker in
                moduleRoot.GetComponentsInChildren<DungeonConnectorGeometryAuthoringV2>(true))
            {
                try
                {
                    Vector3 localFacing = moduleRoot.transform.InverseTransformDirection(marker.transform.forward);
                    if (localFacing.sqrMagnitude <= Mathf.Epsilon)
                    {
                        throw new InvalidOperationException("Connector facing resolves to the zero vector.");
                    }

                    localFacing.Normalize();
                    var connector = new CertifiedDungeonConnectorGeometryV2(
                        marker.StableId,
                        marker.RegionId,
                        marker.Kind,
                        ToCorePoint(moduleRoot.transform.InverseTransformPoint(marker.transform.position)),
                        ToCoreVector(localFacing),
                        marker.SocketTag,
                        BakeConnectorAperture(moduleRoot.transform, marker));
                    connectors.Add(connector);
                    ValidatePointInRegion(
                        connector.RegionId,
                        connector.Position,
                        marker.transform,
                        regionById,
                        issues);
                }
                catch (Exception exception)
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                        marker.transform,
                        exception.Message));
                }
            }

            if (issues.Count > 0)
            {
                return new DungeonCertifiedGeometryBakeResultV2(null, issues);
            }

            try
            {
                var geometry = new CertifiedDungeonModuleGeometryV2(
                    module.TemplateId,
                    surfaces,
                    regions,
                    anchors,
                    connectors);
                return new DungeonCertifiedGeometryBakeResultV2(geometry, issues);
            }
            catch (Exception exception)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                    moduleRoot.transform,
                    exception.Message));
                return new DungeonCertifiedGeometryBakeResultV2(null, issues);
            }
        }

        public static DungeonCertifiedGeometryBakeResultV2 ValidateCurrentBake(GameObject moduleRoot)
        {
            DungeonCertifiedGeometryBakeResultV2 current = Bake(moduleRoot);
            if (!current.IsValid)
            {
                return current;
            }

            var issues = new List<DungeonCertifiedGeometryIssueV2>();
            DungeonModuleGeometryAuthoringV2 module = moduleRoot.GetComponent<DungeonModuleGeometryAuthoringV2>();
            DungeonCertifiedGeometryAssetV2 asset = module.CertifiedGeometry;
            if (asset == null)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MissingBake,
                    moduleRoot.transform,
                    "No certified geometry asset is assigned. Bake this module before it can ship."));
                return new DungeonCertifiedGeometryBakeResultV2(null, issues);
            }

            if (asset.SchemaVersion != CertifiedDungeonModuleGeometryV2.CurrentSchemaVersion)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.UnsupportedSchema,
                    moduleRoot.transform,
                    "Certified geometry schema " + asset.SchemaVersion + " is unsupported."));
            }
            else if (!asset.TryRead(out CertifiedDungeonModuleGeometryV2 stored, out string readError))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.StaleContentHash,
                    moduleRoot.transform,
                    readError));
            }
            else if (!string.Equals(stored.TemplateId, current.Geometry.TemplateId, StringComparison.Ordinal))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.TemplateMismatch,
                    moduleRoot.transform,
                    "Assigned bake belongs to template '" + stored.TemplateId
                        + "', but authoring declares '" + current.Geometry.TemplateId + "'."));
            }
            else if (!string.Equals(stored.ContentHash, current.Geometry.ContentHash, StringComparison.Ordinal))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.StaleContentHash,
                    moduleRoot.transform,
                    "Live collider/marker geometry hashes to " + current.Geometry.ContentHash
                        + ", but the assigned bake hashes to " + stored.ContentHash + ". Re-bake the prefab."));
            }

            return issues.Count == 0
                ? current
                : new DungeonCertifiedGeometryBakeResultV2(null, issues);
        }

        public static DungeonCertifiedGeometryBakeResultV2 BakeIntoAsset(
            GameObject moduleRoot,
            DungeonCertifiedGeometryAssetV2 target)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            DungeonCertifiedGeometryBakeResultV2 result = Bake(moduleRoot);
            if (!result.IsValid)
            {
                return result;
            }

            Undo.RecordObject(target, "Bake certified dungeon geometry");
            target.Store(result.Geometry);
            EditorUtility.SetDirty(target);

            DungeonModuleGeometryAuthoringV2 authoring = moduleRoot.GetComponent<DungeonModuleGeometryAuthoringV2>();
            if (authoring.CertifiedGeometry != target)
            {
                Undo.RecordObject(authoring, "Assign certified dungeon geometry");
                authoring.AssignCertifiedGeometry(target);
                EditorUtility.SetDirty(authoring);
                PrefabUtility.RecordPrefabInstancePropertyModifications(authoring);
            }

            return result;
        }

        private static void ValidateColliderOwnership(
            GameObject root,
            ICollection<DungeonCertifiedGeometryIssueV2> issues)
        {
            foreach (Collider collider in root.GetComponentsInChildren<Collider>(true))
            {
                if (collider.isTrigger)
                {
                    continue;
                }

                if (collider.GetComponent<DungeonSurfaceGeometryAuthoringV2>() == null)
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.UnmarkedCollider,
                        collider.transform,
                        "Every non-trigger collider in a certified module must own a surface marker."));
                }
            }
        }

        private static CertifiedDungeonRegionGeometryV2 BakeRegion(
            Transform moduleRoot,
            DungeonRegionGeometryAuthoringV2 marker)
        {
            Vector3 size = marker.LocalSize;
            if (size.x <= 0f || size.y <= 0f || size.z <= 0f)
            {
                throw new InvalidOperationException("Region local size must be positive on every axis.");
            }

            Vector3 half = size * 0.5f;
            DungeonPoint3[] points = new DungeonPoint3[8];
            int index = 0;
            for (int x = -1; x <= 1; x += 2)
            {
                for (int y = -1; y <= 1; y += 2)
                {
                    for (int z = -1; z <= 1; z += 2)
                    {
                        Vector3 world = marker.transform.TransformPoint(
                            marker.LocalCenter + Vector3.Scale(half, new Vector3(x, y, z)));
                        points[index++] = ToCorePoint(moduleRoot.InverseTransformPoint(world));
                    }
                }
            }

            DungeonBounds3 bounds = BoundsOf(points);
            return new CertifiedDungeonRegionGeometryV2(
                marker.StableId,
                bounds,
                marker.DistrictKind,
                marker.ElevationStratum,
                marker.LocalNavigationRegionId);
        }

        private static void TryBakeSurface(
            Transform moduleRoot,
            DungeonSurfaceGeometryAuthoringV2 marker,
            IReadOnlyDictionary<string, CertifiedDungeonRegionGeometryV2> regions,
            ICollection<CertifiedDungeonSurfaceGeometryV2> destination,
            ICollection<DungeonCertifiedGeometryIssueV2> issues)
        {
            Collider[] colliders = marker.GetComponents<Collider>();
            if (colliders.Length != 1)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MultipleCollidersOnSurface,
                    marker.transform,
                    "Each surface marker must own exactly one collider; found " + colliders.Length + "."));
                return;
            }

            Collider collider = colliders[0];
            if (collider.isTrigger)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.TriggerSurface,
                    marker.transform,
                    "Certified structural/walkable surfaces may not be trigger colliders."));
                return;
            }

            try
            {
                CertifiedDungeonColliderKindV2 colliderKind;
                DungeonConvexPrismV2 prism;
                CertifiedDungeonRampWedgeV2 rampWedge = null;
                if (collider is BoxCollider box)
                {
                    colliderKind = CertifiedDungeonColliderKindV2.Box;
                    prism = BakeBoxPrism(moduleRoot, box);
                }
                else if (collider is MeshCollider meshCollider)
                {
                    if (!meshCollider.convex)
                    {
                        issues.Add(Issue(
                            DungeonCertifiedGeometryIssueCodeV2.NonConvexMesh,
                            marker.transform,
                            "MeshCollider must have Convex enabled."));
                        return;
                    }

                    if (meshCollider.sharedMesh == null)
                    {
                        issues.Add(Issue(
                            DungeonCertifiedGeometryIssueCodeV2.MissingMesh,
                            marker.transform,
                            "MeshCollider has no shared mesh."));
                        return;
                    }

                    DungeonRampGeometryAuthoringV2 ramp =
                        marker.GetComponent<DungeonRampGeometryAuthoringV2>();
                    if (ramp != null)
                    {
                        colliderKind = CertifiedDungeonColliderKindV2.RampWedge;
                        rampWedge = BakeRampWedge(moduleRoot, meshCollider, ramp);
                        prism = rampWedge.BoundingVolume;
                    }
                    else
                    {
                        colliderKind = CertifiedDungeonColliderKindV2.ConvexMesh;
                        prism = BakeMeshPrism(moduleRoot, meshCollider);
                    }
                }
                else
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.UnsupportedCollider,
                        marker.transform,
                        collider.GetType().Name + " cannot be certified. Use BoxCollider or a convex vertical-prism MeshCollider."));
                    return;
                }

                var surface = new CertifiedDungeonSurfaceGeometryV2(
                    marker.StableId,
                    marker.RegionId,
                    marker.Kind,
                    colliderKind,
                    prism,
                    rampWedge,
                    marker.IsStructural,
                    marker.IsWalkable,
                    marker.MaterialProfileId,
                    marker.ActivePredicate,
                    marker.ControllerId);
                destination.Add(surface);
                ValidatePrismInRegion(surface, marker.transform, regions, issues);
            }
            catch (NonPrismaticGeometryException exception)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.NonPrismaticGeometry,
                    marker.transform,
                    exception.Message));
            }
            catch (Exception exception)
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.InvalidAuthoring,
                    marker.transform,
                    exception.Message));
            }
        }

        private static DungeonConvexPrismV2 BakeBoxPrism(Transform moduleRoot, BoxCollider box)
        {
            Vector3 relativeUp = moduleRoot.InverseTransformDirection(box.transform.up).normalized;
            if (Mathf.Abs(Vector3.Dot(relativeUp, Vector3.up)) < 0.9999f)
            {
                throw new NonPrismaticGeometryException(
                    "Tilted BoxColliders are not vertical prisms in module space. Only yaw rotation is supported.");
            }

            Vector3 half = box.size * 0.5f;
            var points = new List<DungeonPoint3>(8);
            for (int x = -1; x <= 1; x += 2)
            {
                for (int y = -1; y <= 1; y += 2)
                {
                    for (int z = -1; z <= 1; z += 2)
                    {
                        Vector3 local = box.center + Vector3.Scale(half, new Vector3(x, y, z));
                        Vector3 moduleLocal = moduleRoot.InverseTransformPoint(box.transform.TransformPoint(local));
                        points.Add(ToCorePoint(moduleLocal));
                    }
                }
            }

            return BuildVerticalPrism(points, requireExtrudedHullCorners: true);
        }

        private static DungeonConvexPrismV2 BakeMeshPrism(Transform moduleRoot, MeshCollider collider)
        {
            Vector3[] vertices = collider.sharedMesh.vertices;
            if (vertices == null || vertices.Length < 6)
            {
                throw new NonPrismaticGeometryException("Convex MeshCollider needs at least six vertices.");
            }

            var points = new List<DungeonPoint3>(vertices.Length);
            foreach (Vector3 vertex in vertices)
            {
                Vector3 moduleLocal = moduleRoot.InverseTransformPoint(collider.transform.TransformPoint(vertex));
                points.Add(ToCorePoint(moduleLocal));
            }

            return BuildVerticalPrism(points, requireExtrudedHullCorners: true);
        }

        private static CertifiedDungeonRampWedgeV2 BakeRampWedge(
            Transform moduleRoot,
            MeshCollider collider,
            DungeonRampGeometryAuthoringV2 authoring)
        {
            Vector3[] vertices = collider.sharedMesh.vertices;
            if (vertices == null || vertices.Length < 6)
            {
                throw new NonPrismaticGeometryException(
                    "Certified ramp MeshCollider needs at least six vertices.");
            }

            var points = new List<DungeonPoint3>(vertices.Length);
            foreach (Vector3 vertex in vertices)
            {
                points.Add(ToCorePoint(moduleRoot.InverseTransformPoint(
                    collider.transform.TransformPoint(vertex))));
            }

            DungeonConvexPrismV2 bounding = BuildVerticalPrism(
                points,
                requireExtrudedHullCorners: false);
            Vector3 unityRise = moduleRoot.InverseTransformDirection(
                collider.transform.TransformDirection(authoring.LocalRiseDirection));
            if (Mathf.Abs(unityRise.y) > 0.0001f)
            {
                throw new NonPrismaticGeometryException(
                    "Ramp rise direction must be horizontal in module space.");
            }

            unityRise.y = 0f;
            if (unityRise.sqrMagnitude <= 0.000001f)
            {
                throw new NonPrismaticGeometryException("Ramp rise direction may not be zero.");
            }

            unityRise.Normalize();
            double lowY = ToCorePoint(moduleRoot.InverseTransformPoint(
                collider.transform.TransformPoint(new Vector3(0f, authoring.LowSurfaceLocalY, 0f)))).Y;
            double highY = ToCorePoint(moduleRoot.InverseTransformPoint(
                collider.transform.TransformPoint(new Vector3(0f, authoring.HighSurfaceLocalY, 0f)))).Y;
            if (highY <= lowY + GeometryTolerance)
            {
                throw new NonPrismaticGeometryException(
                    "Ramp high surface must be above its low surface in module space.");
            }

            bool hasLow = points.Any(point => Math.Abs(point.Y - lowY) <= GeometryTolerance);
            bool hasHigh = points.Any(point => Math.Abs(point.Y - highY) <= GeometryTolerance);
            if (!hasLow || !hasHigh)
            {
                throw new NonPrismaticGeometryException(
                    "Ramp mesh must contain vertices on both declared low and high surface edges.");
            }

            return new CertifiedDungeonRampWedgeV2(
                bounding,
                lowY,
                highY,
                ToCoreVector(unityRise));
        }

        private static DungeonConnectorApertureV2 BakeConnectorAperture(
            Transform moduleRoot,
            DungeonConnectorGeometryAuthoringV2 marker)
        {
            if (marker.CompatibleKinds == null || marker.CompatibleKinds.Count == 0)
            {
                throw new InvalidOperationException(
                    "Connector aperture must declare at least one compatible connector kind.");
            }

            if (string.IsNullOrWhiteSpace(marker.ThemedCapProfileId))
            {
                throw new InvalidOperationException(
                    "Connector aperture must declare a themed cap profile ID.");
            }

            if (string.IsNullOrWhiteSpace(marker.NavigationHandoffProfileId))
                throw new InvalidOperationException("Connector requires a navigation handoff profile ID.");
            if (string.IsNullOrWhiteSpace(marker.ExteriorGasketProfileId))
                throw new InvalidOperationException("Connector requires an exterior gasket profile ID.");
            if (marker.CapState == DungeonConnectorCapStateV2.MechanismControlled
                && string.IsNullOrWhiteSpace(marker.MechanismBindingId))
                throw new InvalidOperationException("Mechanism-controlled connector requires a mechanism binding ID.");

            DungeonConvexPrismV2 aperture = BakeLocalBoxPrism(
                moduleRoot,
                marker.transform,
                marker.LocalApertureCenter,
                marker.LocalApertureSize,
                "Connector aperture");
            DungeonConvexPrismV2 playerClearance = BakeLocalBoxPrism(
                moduleRoot,
                marker.transform,
                marker.LocalPlayerClearanceCenter,
                marker.LocalPlayerClearanceSize,
                "Connector player clearance");
            DungeonConvexPrismV2 cameraClearance = BakeLocalBoxPrism(
                moduleRoot,
                marker.transform,
                marker.LocalCameraClearanceCenter,
                marker.LocalCameraClearanceSize,
                "Connector camera clearance");
            DungeonConvexPrismV2 approach = BakeLocalBoxPrism(
                moduleRoot,
                marker.transform,
                marker.LocalApproachCenter,
                marker.LocalApproachSize,
                "Connector approach volume");
            double floorY = ToCorePoint(moduleRoot.InverseTransformPoint(
                marker.transform.TransformPoint(new Vector3(0f, marker.FloorElevation, 0f)))).Y;

            return new DungeonConnectorApertureV2(
                aperture,
                marker.SocketTag,
                marker.CompatibleKinds,
                marker.ThemedCapProfileId,
                floorY,
                marker.FloorSlopeDegrees,
                playerClearance,
                cameraClearance,
                marker.SeamDepth,
                approach,
                marker.NavigationHandoffProfileId,
                marker.CapState,
                marker.MechanismBindingId,
                marker.ExteriorGasketProfileId,
                marker.VerticalCompositionPortalId);
        }

        private static DungeonConvexPrismV2 BakeLocalBoxPrism(
            Transform moduleRoot,
            Transform localRoot,
            Vector3 center,
            Vector3 size,
            string label)
        {
            if (size.x <= 0f || size.y <= 0f || size.z <= 0f)
                throw new InvalidOperationException(label + " size must be positive on every axis.");

            Vector3 half = size * 0.5f;
            var points = new List<DungeonPoint3>(8);
            for (int x = -1; x <= 1; x += 2)
            for (int y = -1; y <= 1; y += 2)
            for (int z = -1; z <= 1; z += 2)
            {
                Vector3 local = center + Vector3.Scale(half, new Vector3(x, y, z));
                points.Add(ToCorePoint(moduleRoot.InverseTransformPoint(localRoot.TransformPoint(local))));
            }
            return BuildVerticalPrism(points, requireExtrudedHullCorners: true);
        }

        private static DungeonConvexPrismV2 BuildVerticalPrism(
            IReadOnlyList<DungeonPoint3> points,
            bool requireExtrudedHullCorners)
        {
            double minimumY = points.Min(point => point.Y);
            double maximumY = points.Max(point => point.Y);
            if (maximumY - minimumY <= GeometryTolerance)
            {
                throw new NonPrismaticGeometryException("Certified surface has no vertical thickness.");
            }

            List<DungeonPoint2V2> hull = BuildCanonicalHull(points.Select(point => new DungeonPoint2V2(point.X, point.Z)));
            if (hull.Count < 3)
            {
                throw new NonPrismaticGeometryException("Certified surface has a degenerate horizontal footprint.");
            }

            if (requireExtrudedHullCorners)
            {
                foreach (DungeonPoint2V2 corner in hull)
                {
                    bool hasBottom = points.Any(point => SameHorizontal(point, corner)
                        && Math.Abs(point.Y - minimumY) <= GeometryTolerance);
                    bool hasTop = points.Any(point => SameHorizontal(point, corner)
                        && Math.Abs(point.Y - maximumY) <= GeometryTolerance);
                    if (!hasBottom || !hasTop)
                    {
                        throw new NonPrismaticGeometryException(
                            "Collider footprint is tapered, tilted, or otherwise not a vertical extrusion.");
                    }
                }
            }

            return new DungeonConvexPrismV2(hull, minimumY, maximumY);
        }

        private static List<DungeonPoint2V2> BuildCanonicalHull(IEnumerable<DungeonPoint2V2> source)
        {
            List<DungeonPoint2V2> points = source
                .OrderBy(value => value.X)
                .ThenBy(value => value.Z)
                .ToList();
            var unique = new List<DungeonPoint2V2>();
            foreach (DungeonPoint2V2 point in points)
            {
                if (unique.Count == 0 || !SamePoint(unique[unique.Count - 1], point))
                {
                    unique.Add(point);
                }
            }

            if (unique.Count <= 3)
            {
                return unique;
            }

            var lower = new List<DungeonPoint2V2>();
            foreach (DungeonPoint2V2 point in unique)
            {
                while (lower.Count >= 2 && Cross(lower[lower.Count - 2], lower[lower.Count - 1], point) <= GeometryTolerance)
                {
                    lower.RemoveAt(lower.Count - 1);
                }

                lower.Add(point);
            }

            var upper = new List<DungeonPoint2V2>();
            for (int index = unique.Count - 1; index >= 0; index -= 1)
            {
                DungeonPoint2V2 point = unique[index];
                while (upper.Count >= 2 && Cross(upper[upper.Count - 2], upper[upper.Count - 1], point) <= GeometryTolerance)
                {
                    upper.RemoveAt(upper.Count - 1);
                }

                upper.Add(point);
            }

            lower.RemoveAt(lower.Count - 1);
            upper.RemoveAt(upper.Count - 1);
            lower.AddRange(upper);
            return lower;
        }

        private static void ValidatePrismInRegion(
            CertifiedDungeonSurfaceGeometryV2 surface,
            Transform marker,
            IReadOnlyDictionary<string, CertifiedDungeonRegionGeometryV2> regions,
            ICollection<DungeonCertifiedGeometryIssueV2> issues)
        {
            if (!regions.TryGetValue(surface.RegionId, out CertifiedDungeonRegionGeometryV2 region))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MissingRegion,
                    marker,
                    "Surface references missing region '" + surface.RegionId + "'."));
                return;
            }

            foreach (DungeonPoint2V2 point in surface.Volume.HorizontalVertices)
            {
                var bottom = new DungeonPoint3(point.X, surface.Volume.MinimumY, point.Z);
                var top = new DungeonPoint3(point.X, surface.Volume.MaximumY, point.Z);
                if (!region.Bounds.Contains(bottom, GeometryTolerance)
                    || !region.Bounds.Contains(top, GeometryTolerance))
                {
                    issues.Add(Issue(
                        DungeonCertifiedGeometryIssueCodeV2.GeometryOutsideRegion,
                        marker,
                        "Surface '" + surface.Id + "' lies outside owning region '" + region.Id + "'."));
                    return;
                }
            }
        }

        private static void ValidatePointInRegion(
            string regionId,
            DungeonPoint3 point,
            Transform marker,
            IReadOnlyDictionary<string, CertifiedDungeonRegionGeometryV2> regions,
            ICollection<DungeonCertifiedGeometryIssueV2> issues)
        {
            if (!regions.TryGetValue(regionId, out CertifiedDungeonRegionGeometryV2 region))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.MissingRegion,
                    marker,
                    "Marker references missing region '" + regionId + "'."));
            }
            else if (!region.Bounds.Contains(point, GeometryTolerance))
            {
                issues.Add(Issue(
                    DungeonCertifiedGeometryIssueCodeV2.GeometryOutsideRegion,
                    marker,
                    "Marker lies outside owning region '" + regionId + "'."));
            }
        }

        private static DungeonBounds3 BoundsOf(IReadOnlyList<DungeonPoint3> points)
        {
            double minimumX = points.Min(value => value.X);
            double minimumY = points.Min(value => value.Y);
            double minimumZ = points.Min(value => value.Z);
            double maximumX = points.Max(value => value.X);
            double maximumY = points.Max(value => value.Y);
            double maximumZ = points.Max(value => value.Z);
            return new DungeonBounds3(
                new DungeonPoint3(minimumX, minimumY, minimumZ),
                new DungeonPoint3(maximumX, maximumY, maximumZ));
        }

        private static DungeonPoint3 ToCorePoint(Vector3 unityLocal)
        {
            return new DungeonPoint3(
                Canonicalize(-unityLocal.x),
                Canonicalize(unityLocal.y),
                Canonicalize(unityLocal.z));
        }

        private static DungeonPoint3 ToCoreVector(Vector3 unityLocal)
        {
            return new DungeonPoint3(
                Canonicalize(-unityLocal.x),
                Canonicalize(unityLocal.y),
                Canonicalize(unityLocal.z));
        }

        private static double Canonicalize(double value)
        {
            double rounded = Math.Round(value, 6, MidpointRounding.AwayFromZero);
            return Math.Abs(rounded) <= 0.0000005d ? 0d : rounded;
        }

        private static bool SameHorizontal(DungeonPoint3 point, DungeonPoint2V2 horizontal)
        {
            return Math.Abs(point.X - horizontal.X) <= GeometryTolerance
                && Math.Abs(point.Z - horizontal.Z) <= GeometryTolerance;
        }

        private static bool SamePoint(DungeonPoint2V2 left, DungeonPoint2V2 right)
        {
            return Math.Abs(left.X - right.X) <= GeometryTolerance
                && Math.Abs(left.Z - right.Z) <= GeometryTolerance;
        }

        private static double Cross(DungeonPoint2V2 origin, DungeonPoint2V2 a, DungeonPoint2V2 b)
        {
            return (a.X - origin.X) * (b.Z - origin.Z) - (a.Z - origin.Z) * (b.X - origin.X);
        }

        private static DungeonCertifiedGeometryIssueV2 Issue(
            DungeonCertifiedGeometryIssueCodeV2 code,
            Transform target,
            string message)
        {
            return new DungeonCertifiedGeometryIssueV2(code, TransformPath(target), message);
        }

        private static string TransformPath(Transform target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            string result = target.name;
            while (target.parent != null)
            {
                target = target.parent;
                result = target.name + "/" + result;
            }

            return result;
        }

        private sealed class NonPrismaticGeometryException : Exception
        {
            public NonPrismaticGeometryException(string message) : base(message)
            {
            }
        }
    }

    public static class DungeonCertifiedGeometryPrefabToolsV2
    {
        [MenuItem("CONTEXT/DungeonModuleGeometryAuthoringV2/Validate Authored Module")]
        private static void ValidateFromContext(MenuCommand command)
        {
            var authoring = command.context as DungeonModuleGeometryAuthoringV2;
            if (authoring == null)
            {
                return;
            }

            DungeonAuthoredModuleValidationResultV2 result =
                DungeonAuthoredModuleValidatorV2.Validate(authoring.gameObject, requireCurrentBake: true);
            if (!result.IsValid)
            {
                Debug.LogError(DungeonAuthoredModuleLibraryBakerV2.Format(result.Issues), authoring);
            }
            else
            {
                Debug.Log("Authored module is current: " + result.Geometry.ContentHash + ".", authoring);
            }
        }

        public static DungeonCertifiedGeometryBakeResultV2 ValidatePrefabAsset(string prefabPath)
        {
            GameObject root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                return DungeonCertifiedGeometryBakerV2.ValidateCurrentBake(root);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        internal static string FormatIssues(IEnumerable<DungeonCertifiedGeometryIssueV2> issues)
        {
            return "Dungeon V2 certified-geometry validation failed:\n- "
                + string.Join("\n- ", issues.Select(issue => issue.ToString()));
        }
    }

    public sealed class DungeonCertifiedGeometryBuildValidatorV2 : IPreprocessBuildWithReport
    {
        public int callbackOrder => -500;

        public void OnPreprocessBuild(BuildReport report)
        {
            var failures = new List<string>();
            foreach (string guid in AssetDatabase.FindAssets("t:Prefab"))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null || prefab.GetComponent<DungeonModuleGeometryAuthoringV2>() == null)
                {
                    continue;
                }

                DungeonAuthoredModuleValidationResultV2 validation =
                    DungeonAuthoredModuleLibraryBakerV2.ValidatePrefabAsset(path);
                if (!validation.IsValid)
                {
                    failures.Add(path + "\n" + DungeonAuthoredModuleLibraryBakerV2.Format(validation.Issues));
                }
            }

            if (failures.Count > 0)
            {
                throw new BuildFailedException(
                    "Dungeon V2 module prefabs contain missing, unsupported, or stale certified geometry:\n"
                        + string.Join("\n\n", failures));
            }
        }
    }
}
