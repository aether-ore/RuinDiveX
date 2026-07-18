using System;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Editor.DungeonV2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonCertifiedGeometryBakerV2Tests
    {
        private GameObject root;
        private DungeonModuleGeometryAuthoringV2 module;
        private DungeonCertifiedGeometryAssetV2 asset;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("CertifiedModuleRoot");
            module = root.AddComponent<DungeonModuleGeometryAuthoringV2>();
            module.Configure("factory-security-a-v2");
            asset = ScriptableObject.CreateInstance<DungeonCertifiedGeometryAssetV2>();
            CreateRegion(root.transform, "region-entry", new Vector3(0f, 2f, 0f), new Vector3(20f, 8f, 20f));
        }

        [TearDown]
        public void TearDown()
        {
            if (root != null)
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            if (asset != null)
            {
                UnityEngine.Object.DestroyImmediate(asset);
            }
        }

        [Test]
        public void BoxSurfaceMarkersBakeToImmutableCoreGeometryWithCoordinateConversion()
        {
            BoxCollider box = CreateBoxSurface(
                "floor-surface",
                "region-entry",
                new Vector3(2f, 0.5f, 3f),
                new Vector3(4f, 1f, 6f));
            CreateAnchor("safe-anchor", "region-entry", new Vector3(2f, 1f, 3f));
            CreateConnector("east-socket", "region-entry", new Vector3(4f, 1f, 3f), Quaternion.Euler(0f, 90f, 0f));

            DungeonCertifiedGeometryBakeResultV2 result = DungeonCertifiedGeometryBakerV2.Bake(root);

            Assert.That(result.IsValid, Is.True, JoinIssues(result));
            Assert.That(result.Geometry.SchemaVersion, Is.EqualTo(1));
            Assert.That(result.Geometry.ContentHash, Does.StartWith("sha256:"));
            Assert.That(result.Geometry.Surfaces, Has.Count.EqualTo(1));
            Assert.That(result.Geometry.Anchors, Has.Count.EqualTo(1));
            Assert.That(result.Geometry.Connectors, Has.Count.EqualTo(1));

            CertifiedDungeonSurfaceGeometryV2 surface = result.Geometry.Surfaces.Single();
            Assert.That(surface.ColliderKind, Is.EqualTo(CertifiedDungeonColliderKindV2.Box));
            Assert.That(surface.Volume.MinimumY, Is.EqualTo(0d).Within(1e-9));
            Assert.That(surface.Volume.MaximumY, Is.EqualTo(1d).Within(1e-9));
            Assert.That(surface.Volume.HorizontalVertices.Min(value => value.X), Is.EqualTo(-4d).Within(1e-9));
            Assert.That(surface.Volume.HorizontalVertices.Max(value => value.X), Is.EqualTo(0d).Within(1e-9));
            Assert.That(surface.Volume.HorizontalVertices.Min(value => value.Z), Is.EqualTo(0d).Within(1e-9));
            Assert.That(surface.Volume.HorizontalVertices.Max(value => value.Z), Is.EqualTo(6d).Within(1e-9));
            Assert.That(box, Is.Not.Null);

            CertifiedDungeonAnchorGeometryV2 anchor = result.Geometry.Anchors.Single();
            Assert.That(anchor.Position, Is.EqualTo(new DungeonPoint3(-2d, 1d, 3d)));
            CertifiedDungeonConnectorGeometryV2 connector = result.Geometry.Connectors.Single();
            Assert.That(connector.Facing.X, Is.EqualTo(-1d).Within(1e-6));
            Assert.That(connector.Facing.Y, Is.EqualTo(0d).Within(1e-6));
            Assert.That(connector.Facing.Z, Is.EqualTo(0d).Within(1e-6));
        }

        [Test]
        public void CanonicalHashDoesNotDependOnHierarchyOrder()
        {
            BoxCollider first = CreateBoxSurface(
                "surface-b",
                "region-entry",
                new Vector3(-3f, 0.5f, 0f),
                new Vector3(2f, 1f, 2f));
            BoxCollider second = CreateBoxSurface(
                "surface-a",
                "region-entry",
                new Vector3(3f, 0.5f, 0f),
                new Vector3(2f, 1f, 2f));

            string firstHash = DungeonCertifiedGeometryBakerV2.Bake(root).Geometry.ContentHash;
            second.transform.SetSiblingIndex(0);
            first.transform.SetAsLastSibling();
            DungeonCertifiedGeometryBakeResultV2 reordered = DungeonCertifiedGeometryBakerV2.Bake(root);

            Assert.That(reordered.IsValid, Is.True, JoinIssues(reordered));
            Assert.That(reordered.Geometry.ContentHash, Is.EqualTo(firstHash));
            Assert.That(reordered.Geometry.Surfaces.Select(value => value.Id),
                Is.EqualTo(new[] { "surface-a", "surface-b" }));
        }

        [Test]
        public void LiveColliderChangeMakesAssignedBakeVisiblyStale()
        {
            BoxCollider box = CreateBoxSurface(
                "floor-surface",
                "region-entry",
                Vector3.up * 0.5f,
                new Vector3(8f, 1f, 8f));
            DungeonCertifiedGeometryBakeResultV2 baked =
                DungeonCertifiedGeometryBakerV2.BakeIntoAsset(root, asset);
            Assert.That(baked.IsValid, Is.True, JoinIssues(baked));
            Assert.That(asset.TryRead(out CertifiedDungeonModuleGeometryV2 immutable, out string error),
                Is.True,
                error);
            Assert.That(immutable.ContentHash, Is.EqualTo(baked.Geometry.ContentHash));
            Assert.That(DungeonCertifiedGeometryBakerV2.ValidateCurrentBake(root).IsValid, Is.True);

            box.size += Vector3.right;
            DungeonCertifiedGeometryBakeResultV2 stale =
                DungeonCertifiedGeometryBakerV2.ValidateCurrentBake(root);

            Assert.That(stale.IsValid, Is.False);
            Assert.That(stale.Issues.Select(value => value.Code),
                Does.Contain(DungeonCertifiedGeometryIssueCodeV2.StaleContentHash));
            Assert.That(stale.Issues.Single().Message, Does.Contain("Re-bake"));
        }

        [Test]
        public void ConvexVerticalPrismMeshIsSupported()
        {
            GameObject surface = new GameObject("ConvexMeshSurface");
            surface.transform.SetParent(root.transform, false);
            MeshCollider collider = surface.AddComponent<MeshCollider>();
            collider.sharedMesh = CreateBoxMesh();
            collider.convex = true;
            DungeonSurfaceGeometryAuthoringV2 marker = surface.AddComponent<DungeonSurfaceGeometryAuthoringV2>();
            marker.Configure(
                "mesh-surface",
                "region-entry",
                DungeonSurfaceKindV2.SolidOccupancy,
                true,
                false,
                "factory-solid");

            DungeonCertifiedGeometryBakeResultV2 result = DungeonCertifiedGeometryBakerV2.Bake(root);

            Assert.That(result.IsValid, Is.True, JoinIssues(result));
            Assert.That(result.Geometry.Surfaces.Single().ColliderKind,
                Is.EqualTo(CertifiedDungeonColliderKindV2.ConvexMesh));
            UnityEngine.Object.DestroyImmediate(collider.sharedMesh);
        }

        [Test]
        public void UnsupportedAndNonPrismaticCollidersAreRejected()
        {
            GameObject capsuleObject = new GameObject("UnsupportedCapsule");
            capsuleObject.transform.SetParent(root.transform, false);
            capsuleObject.AddComponent<CapsuleCollider>();
            DungeonSurfaceGeometryAuthoringV2 capsuleMarker =
                capsuleObject.AddComponent<DungeonSurfaceGeometryAuthoringV2>();
            capsuleMarker.Configure(
                "capsule-surface",
                "region-entry",
                DungeonSurfaceKindV2.Structural,
                true,
                false,
                "factory-solid");

            DungeonCertifiedGeometryBakeResultV2 unsupported = DungeonCertifiedGeometryBakerV2.Bake(root);
            Assert.That(unsupported.IsValid, Is.False);
            Assert.That(unsupported.Issues.Select(value => value.Code),
                Does.Contain(DungeonCertifiedGeometryIssueCodeV2.UnsupportedCollider));

            UnityEngine.Object.DestroyImmediate(capsuleObject);
            BoxCollider tilted = CreateBoxSurface(
                "tilted-surface",
                "region-entry",
                Vector3.up,
                new Vector3(2f, 2f, 2f));
            tilted.transform.localRotation = Quaternion.Euler(15f, 0f, 0f);
            DungeonCertifiedGeometryBakeResultV2 nonPrismatic = DungeonCertifiedGeometryBakerV2.Bake(root);
            Assert.That(nonPrismatic.IsValid, Is.False);
            Assert.That(nonPrismatic.Issues.Select(value => value.Code),
                Does.Contain(DungeonCertifiedGeometryIssueCodeV2.NonPrismaticGeometry));
        }

        [Test]
        public void UnmarkedColliderAndOutOfRegionGeometryAreRejected()
        {
            GameObject stray = new GameObject("ForgottenCollider");
            stray.transform.SetParent(root.transform, false);
            stray.AddComponent<BoxCollider>();
            DungeonCertifiedGeometryBakeResultV2 unmarked = DungeonCertifiedGeometryBakerV2.Bake(root);
            Assert.That(unmarked.IsValid, Is.False);
            Assert.That(unmarked.Issues.Select(value => value.Code),
                Does.Contain(DungeonCertifiedGeometryIssueCodeV2.UnmarkedCollider));
            UnityEngine.Object.DestroyImmediate(stray);

            CreateBoxSurface(
                "outside-surface",
                "region-entry",
                new Vector3(25f, 0.5f, 0f),
                new Vector3(2f, 1f, 2f));
            DungeonCertifiedGeometryBakeResultV2 outside = DungeonCertifiedGeometryBakerV2.Bake(root);
            Assert.That(outside.IsValid, Is.False);
            Assert.That(outside.Issues.Select(value => value.Code),
                Does.Contain(DungeonCertifiedGeometryIssueCodeV2.GeometryOutsideRegion));
        }

        [Test]
        public void CoreModuleValidationRejectsTemplateAndHashDrift()
        {
            CreateBoxSurface(
                "floor-surface",
                "region-entry",
                Vector3.up * 0.5f,
                new Vector3(8f, 1f, 8f));
            CertifiedDungeonModuleGeometryV2 geometry = DungeonCertifiedGeometryBakerV2.Bake(root).Geometry;
            var bounds = new DungeonBounds3(
                new DungeonPoint3(-10d, -2d, -10d),
                new DungeonPoint3(10d, 8d, 10d));

            var validModule = new DungeonModuleInstancePlanV2(
                "module-instance",
                geometry.TemplateId,
                geometry.ContentHash,
                "macro-security",
                bounds,
                new[] { "region-entry" },
                Array.Empty<string>(),
                Array.Empty<string>());
            Assert.That(geometry.ValidateModuleInstance(validModule).IsValid, Is.True);

            var staleModule = new DungeonModuleInstancePlanV2(
                "module-instance",
                geometry.TemplateId,
                "sha256:stale",
                "macro-security",
                bounds,
                new[] { "region-entry" },
                Array.Empty<string>(),
                Array.Empty<string>());
            Assert.That(geometry.ValidateModuleInstance(staleModule).Code,
                Is.EqualTo(CertifiedDungeonGeometryValidationCodeV2.ContentHashMismatch));

            var wrongTemplate = new DungeonModuleInstancePlanV2(
                "module-instance",
                "different-template-v2",
                geometry.ContentHash,
                "macro-security",
                bounds,
                new[] { "region-entry" },
                Array.Empty<string>(),
                Array.Empty<string>());
            Assert.That(geometry.ValidateModuleInstance(wrongTemplate).Code,
                Is.EqualTo(CertifiedDungeonGeometryValidationCodeV2.TemplateMismatch));
        }

        private static DungeonRegionGeometryAuthoringV2 CreateRegion(
            Transform parent,
            string id,
            Vector3 center,
            Vector3 size)
        {
            GameObject regionObject = new GameObject("Region_" + id);
            regionObject.transform.SetParent(parent, false);
            DungeonRegionGeometryAuthoringV2 region =
                regionObject.AddComponent<DungeonRegionGeometryAuthoringV2>();
            region.Configure(
                id,
                center,
                size,
                DungeonBiomeDistrictKindV2.Factory,
                DungeonElevationStratumV2.Entry,
                "nav-" + id);
            return region;
        }

        private BoxCollider CreateBoxSurface(
            string id,
            string regionId,
            Vector3 position,
            Vector3 size)
        {
            GameObject surfaceObject = new GameObject("Surface_" + id);
            surfaceObject.transform.SetParent(root.transform, false);
            surfaceObject.transform.localPosition = position;
            BoxCollider box = surfaceObject.AddComponent<BoxCollider>();
            box.size = size;
            DungeonSurfaceGeometryAuthoringV2 marker =
                surfaceObject.AddComponent<DungeonSurfaceGeometryAuthoringV2>();
            marker.Configure(
                id,
                regionId,
                DungeonSurfaceKindV2.Walkable,
                true,
                true,
                "factory-floor");
            return box;
        }

        private void CreateAnchor(string id, string regionId, Vector3 position)
        {
            GameObject anchorObject = new GameObject("Anchor_" + id);
            anchorObject.transform.SetParent(root.transform, false);
            anchorObject.transform.localPosition = position;
            DungeonAnchorGeometryAuthoringV2 marker =
                anchorObject.AddComponent<DungeonAnchorGeometryAuthoringV2>();
            marker.Configure(id, regionId, DungeonAnchorKindV2.Safe, "safe-reset-v2");
        }

        private void CreateConnector(string id, string regionId, Vector3 position, Quaternion rotation)
        {
            GameObject connectorObject = new GameObject("Connector_" + id);
            connectorObject.transform.SetParent(root.transform, false);
            connectorObject.transform.localPosition = position;
            connectorObject.transform.localRotation = rotation;
            DungeonConnectorGeometryAuthoringV2 marker =
                connectorObject.AddComponent<DungeonConnectorGeometryAuthoringV2>();
            marker.Configure(id, regionId, DungeonConnectorKindV2.Ground, "factory-ground-v2");
        }

        private static Mesh CreateBoxMesh()
        {
            var mesh = new Mesh { name = "CertifiedBoxMesh" };
            mesh.vertices = new[]
            {
                new Vector3(-1f, 0f, -1f),
                new Vector3(1f, 0f, -1f),
                new Vector3(1f, 0f, 1f),
                new Vector3(-1f, 0f, 1f),
                new Vector3(-1f, 2f, -1f),
                new Vector3(1f, 2f, -1f),
                new Vector3(1f, 2f, 1f),
                new Vector3(-1f, 2f, 1f)
            };
            mesh.triangles = new[]
            {
                0, 2, 1, 0, 3, 2,
                4, 5, 6, 4, 6, 7,
                0, 1, 5, 0, 5, 4,
                1, 2, 6, 1, 6, 5,
                2, 3, 7, 2, 7, 6,
                3, 0, 4, 3, 4, 7
            };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static string JoinIssues(DungeonCertifiedGeometryBakeResultV2 result)
        {
            return string.Join("\n", result.Issues.Select(value => value.ToString()));
        }
    }
}
