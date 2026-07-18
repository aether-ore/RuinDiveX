using System;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// Serialized Unity representation of the immutable Core geometry record.
    /// Runtime consumers reconstruct and re-hash the Core DTO before use.
    /// </summary>
    [CreateAssetMenu(
        fileName = "CertifiedDungeonGeometryV2",
        menuName = "RuinCrawler/Dungeon V2/Certified Module Geometry")]
    public sealed class DungeonCertifiedGeometryAssetV2 : ScriptableObject
    {
        [SerializeField] private int schemaVersion;
        [SerializeField] private string templateId;
        [SerializeField] private string contentHash;
        [SerializeField, TextArea(3, 12)] private string canonicalContent;
        [SerializeField] private CertifiedSurfaceDataV2[] surfaces = Array.Empty<CertifiedSurfaceDataV2>();
        [SerializeField] private CertifiedRegionDataV2[] regions = Array.Empty<CertifiedRegionDataV2>();
        [SerializeField] private CertifiedAnchorDataV2[] anchors = Array.Empty<CertifiedAnchorDataV2>();
        [SerializeField] private CertifiedConnectorDataV2[] connectors = Array.Empty<CertifiedConnectorDataV2>();

        public int SchemaVersion => schemaVersion;
        public string TemplateId => templateId;
        public string ContentHash => contentHash;
        public string CanonicalContent => canonicalContent;

        public bool TryRead(out CertifiedDungeonModuleGeometryV2 geometry, out string error)
        {
            geometry = null;
            if (schemaVersion != CertifiedDungeonModuleGeometryV2.CurrentSchemaVersion)
            {
                error = "Unsupported certified geometry schema " + schemaVersion
                    + "; expected " + CertifiedDungeonModuleGeometryV2.CurrentSchemaVersion + ".";
                return false;
            }

            try
            {
                geometry = BuildCoreGeometry();
            }
            catch (Exception exception)
            {
                error = "Certified geometry payload is invalid: " + exception.Message;
                return false;
            }

            if (!string.Equals(geometry.ContentHash, contentHash, StringComparison.Ordinal))
            {
                error = "Certified geometry content hash is stale or corrupted. Stored " + contentHash
                    + ", reconstructed " + geometry.ContentHash + ". Re-bake the module prefab.";
                geometry = null;
                return false;
            }

            if (!string.Equals(geometry.CanonicalContent, canonicalContent, StringComparison.Ordinal))
            {
                error = "Certified geometry canonical payload does not match its serialized records. Re-bake the module prefab.";
                geometry = null;
                return false;
            }

            error = string.Empty;
            return true;
        }

        public CertifiedDungeonModuleGeometryV2 ReadOrThrow()
        {
            if (!TryRead(out CertifiedDungeonModuleGeometryV2 geometry, out string error))
            {
                throw new InvalidOperationException(error);
            }

            return geometry;
        }

        public void Store(CertifiedDungeonModuleGeometryV2 geometry)
        {
            if (geometry == null)
            {
                throw new ArgumentNullException(nameof(geometry));
            }

            schemaVersion = geometry.SchemaVersion;
            templateId = geometry.TemplateId;
            contentHash = geometry.ContentHash;
            canonicalContent = geometry.CanonicalContent;
            surfaces = geometry.Surfaces.Select(CertifiedSurfaceDataV2.FromCore);
            regions = geometry.Regions.Select(CertifiedRegionDataV2.FromCore);
            anchors = geometry.Anchors.Select(CertifiedAnchorDataV2.FromCore);
            connectors = geometry.Connectors.Select(CertifiedConnectorDataV2.FromCore);
        }

        private CertifiedDungeonModuleGeometryV2 BuildCoreGeometry()
        {
            return new CertifiedDungeonModuleGeometryV2(
                templateId,
                Select(surfaces, value => value.ToCore()),
                Select(regions, value => value.ToCore()),
                Select(anchors, value => value.ToCore()),
                Select(connectors, value => value.ToCore()));
        }

        private static TResult[] Select<TSource, TResult>(TSource[] source, Func<TSource, TResult> selector)
        {
            if (source == null)
            {
                return Array.Empty<TResult>();
            }

            var result = new TResult[source.Length];
            for (int index = 0; index < source.Length; index += 1)
            {
                if (source[index] == null)
                {
                    throw new InvalidOperationException("Certified geometry arrays may not contain null records.");
                }

                result[index] = selector(source[index]);
            }

            return result;
        }
    }

    [Serializable]
    internal sealed class CertifiedSurfaceDataV2
    {
        [SerializeField] private string id;
        [SerializeField] private string regionId;
        [SerializeField] private DungeonSurfaceKindV2 kind;
        [SerializeField] private CertifiedDungeonColliderKindV2 colliderKind;
        [SerializeField] private CertifiedPrismDataV2 volume;
        [SerializeField] private bool isStructural;
        [SerializeField] private bool isWalkable;
        [SerializeField] private string materialProfileId;

        public CertifiedDungeonSurfaceGeometryV2 ToCore()
        {
            return new CertifiedDungeonSurfaceGeometryV2(
                id,
                regionId,
                kind,
                colliderKind,
                volume.ToCore(),
                isStructural,
                isWalkable,
                materialProfileId);
        }

        public static CertifiedSurfaceDataV2 FromCore(CertifiedDungeonSurfaceGeometryV2 value)
        {
            return new CertifiedSurfaceDataV2
            {
                id = value.Id,
                regionId = value.RegionId,
                kind = value.Kind,
                colliderKind = value.ColliderKind,
                volume = CertifiedPrismDataV2.FromCore(value.Volume),
                isStructural = value.IsStructural,
                isWalkable = value.IsWalkable,
                materialProfileId = value.MaterialProfileId
            };
        }
    }

    [Serializable]
    internal sealed class CertifiedRegionDataV2
    {
        [SerializeField] private string id;
        [SerializeField] private CertifiedPoint3DataV2 minimum;
        [SerializeField] private CertifiedPoint3DataV2 maximum;
        [SerializeField] private DungeonBiomeDistrictKindV2 districtKind;
        [SerializeField] private DungeonElevationStratumV2 elevationStratum;
        [SerializeField] private string localNavigationRegionId;

        public CertifiedDungeonRegionGeometryV2 ToCore()
        {
            return new CertifiedDungeonRegionGeometryV2(
                id,
                new DungeonBounds3(minimum.ToCore(), maximum.ToCore()),
                districtKind,
                elevationStratum,
                localNavigationRegionId);
        }

        public static CertifiedRegionDataV2 FromCore(CertifiedDungeonRegionGeometryV2 value)
        {
            return new CertifiedRegionDataV2
            {
                id = value.Id,
                minimum = CertifiedPoint3DataV2.FromCore(value.Bounds.Minimum),
                maximum = CertifiedPoint3DataV2.FromCore(value.Bounds.Maximum),
                districtKind = value.DistrictKind,
                elevationStratum = value.ElevationStratum,
                localNavigationRegionId = value.LocalNavigationRegionId
            };
        }
    }

    [Serializable]
    internal sealed class CertifiedAnchorDataV2
    {
        [SerializeField] private string id;
        [SerializeField] private string regionId;
        [SerializeField] private DungeonAnchorKindV2 kind;
        [SerializeField] private CertifiedPoint3DataV2 position;
        [SerializeField] private string profileId;

        public CertifiedDungeonAnchorGeometryV2 ToCore()
        {
            return new CertifiedDungeonAnchorGeometryV2(
                id,
                regionId,
                kind,
                position.ToCore(),
                string.IsNullOrWhiteSpace(profileId) ? null : profileId);
        }

        public static CertifiedAnchorDataV2 FromCore(CertifiedDungeonAnchorGeometryV2 value)
        {
            return new CertifiedAnchorDataV2
            {
                id = value.Id,
                regionId = value.RegionId,
                kind = value.Kind,
                position = CertifiedPoint3DataV2.FromCore(value.Position),
                profileId = value.ProfileId
            };
        }
    }

    [Serializable]
    internal sealed class CertifiedConnectorDataV2
    {
        [SerializeField] private string id;
        [SerializeField] private string regionId;
        [SerializeField] private DungeonConnectorKindV2 kind;
        [SerializeField] private CertifiedPoint3DataV2 position;
        [SerializeField] private CertifiedPoint3DataV2 facing;
        [SerializeField] private string socketTag;

        public CertifiedDungeonConnectorGeometryV2 ToCore()
        {
            return new CertifiedDungeonConnectorGeometryV2(
                id,
                regionId,
                kind,
                position.ToCore(),
                facing.ToCore(),
                socketTag);
        }

        public static CertifiedConnectorDataV2 FromCore(CertifiedDungeonConnectorGeometryV2 value)
        {
            return new CertifiedConnectorDataV2
            {
                id = value.Id,
                regionId = value.RegionId,
                kind = value.Kind,
                position = CertifiedPoint3DataV2.FromCore(value.Position),
                facing = CertifiedPoint3DataV2.FromCore(value.Facing),
                socketTag = value.SocketTag
            };
        }
    }

    [Serializable]
    internal sealed class CertifiedPrismDataV2
    {
        [SerializeField] private CertifiedPoint2DataV2[] horizontalVertices = Array.Empty<CertifiedPoint2DataV2>();
        [SerializeField] private double minimumY;
        [SerializeField] private double maximumY;

        public DungeonConvexPrismV2 ToCore()
        {
            return new DungeonConvexPrismV2(
                Select(horizontalVertices, value => value.ToCore()),
                minimumY,
                maximumY);
        }

        public static CertifiedPrismDataV2 FromCore(DungeonConvexPrismV2 value)
        {
            var vertices = new CertifiedPoint2DataV2[value.HorizontalVertices.Count];
            for (int index = 0; index < value.HorizontalVertices.Count; index += 1)
            {
                vertices[index] = CertifiedPoint2DataV2.FromCore(value.HorizontalVertices[index]);
            }

            return new CertifiedPrismDataV2
            {
                horizontalVertices = vertices,
                minimumY = value.MinimumY,
                maximumY = value.MaximumY
            };
        }

        private static TResult[] Select<TSource, TResult>(TSource[] source, Func<TSource, TResult> selector)
        {
            if (source == null)
            {
                return Array.Empty<TResult>();
            }

            var result = new TResult[source.Length];
            for (int index = 0; index < source.Length; index += 1)
            {
                if (source[index] == null)
                {
                    throw new InvalidOperationException("Certified prism vertices may not be null.");
                }

                result[index] = selector(source[index]);
            }

            return result;
        }
    }

    [Serializable]
    internal sealed class CertifiedPoint2DataV2
    {
        [SerializeField] private double x;
        [SerializeField] private double z;

        public DungeonPoint2V2 ToCore() => new DungeonPoint2V2(x, z);

        public static CertifiedPoint2DataV2 FromCore(DungeonPoint2V2 value)
        {
            return new CertifiedPoint2DataV2 { x = value.X, z = value.Z };
        }
    }

    [Serializable]
    internal sealed class CertifiedPoint3DataV2
    {
        [SerializeField] private double x;
        [SerializeField] private double y;
        [SerializeField] private double z;

        public DungeonPoint3 ToCore() => new DungeonPoint3(x, y, z);

        public static CertifiedPoint3DataV2 FromCore(DungeonPoint3 value)
        {
            return new CertifiedPoint3DataV2 { x = value.X, y = value.Y, z = value.Z };
        }
    }

    internal static class CertifiedGeometryDataArrayExtensionsV2
    {
        public static CertifiedSurfaceDataV2[] Select(
            this System.Collections.Generic.IReadOnlyList<CertifiedDungeonSurfaceGeometryV2> values,
            Func<CertifiedDungeonSurfaceGeometryV2, CertifiedSurfaceDataV2> selector)
        {
            var result = new CertifiedSurfaceDataV2[values.Count];
            for (int index = 0; index < values.Count; index += 1) result[index] = selector(values[index]);
            return result;
        }

        public static CertifiedRegionDataV2[] Select(
            this System.Collections.Generic.IReadOnlyList<CertifiedDungeonRegionGeometryV2> values,
            Func<CertifiedDungeonRegionGeometryV2, CertifiedRegionDataV2> selector)
        {
            var result = new CertifiedRegionDataV2[values.Count];
            for (int index = 0; index < values.Count; index += 1) result[index] = selector(values[index]);
            return result;
        }

        public static CertifiedAnchorDataV2[] Select(
            this System.Collections.Generic.IReadOnlyList<CertifiedDungeonAnchorGeometryV2> values,
            Func<CertifiedDungeonAnchorGeometryV2, CertifiedAnchorDataV2> selector)
        {
            var result = new CertifiedAnchorDataV2[values.Count];
            for (int index = 0; index < values.Count; index += 1) result[index] = selector(values[index]);
            return result;
        }

        public static CertifiedConnectorDataV2[] Select(
            this System.Collections.Generic.IReadOnlyList<CertifiedDungeonConnectorGeometryV2> values,
            Func<CertifiedDungeonConnectorGeometryV2, CertifiedConnectorDataV2> selector)
        {
            var result = new CertifiedConnectorDataV2[values.Count];
            for (int index = 0; index < values.Count; index += 1) result[index] = selector(values[index]);
            return result;
        }
    }
}
