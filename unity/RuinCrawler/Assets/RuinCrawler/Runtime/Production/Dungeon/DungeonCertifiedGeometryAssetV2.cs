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
        [SerializeField] private CertifiedRampWedgeDataV2 rampWedge;
        [SerializeField] private bool isStructural;
        [SerializeField] private bool isWalkable;
        [SerializeField] private string materialProfileId;
        [SerializeField] private CertifiedPredicateDataV2 activePredicate;
        [SerializeField] private string controllerId;

        public CertifiedDungeonSurfaceGeometryV2 ToCore()
        {
            return new CertifiedDungeonSurfaceGeometryV2(
                id,
                regionId,
                kind,
                colliderKind,
                volume.ToCore(),
                rampWedge?.ToCore(),
                isStructural,
                isWalkable,
                materialProfileId,
                activePredicate?.ToCore() ?? DungeonAccessPredicateV2.Always,
                string.IsNullOrWhiteSpace(controllerId) ? null : controllerId);
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
                rampWedge = CertifiedRampWedgeDataV2.FromCore(value.RampWedge),
                isStructural = value.IsStructural,
                isWalkable = value.IsWalkable,
                materialProfileId = value.MaterialProfileId,
                activePredicate = CertifiedPredicateDataV2.FromCore(value.ActivePredicate),
                controllerId = value.ControllerId
            };
        }
    }

    [Serializable]
    internal sealed class CertifiedPredicateDataV2
    {
        [SerializeField] private CertifiedPredicateClauseDataV2[] clauses =
            Array.Empty<CertifiedPredicateClauseDataV2>();

        public DungeonAccessPredicateV2 ToCore()
        {
            return new DungeonAccessPredicateV2(
                Select(clauses, value => value.ToCore()));
        }

        public static CertifiedPredicateDataV2 FromCore(DungeonAccessPredicateV2 value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            return new CertifiedPredicateDataV2
            {
                clauses = Select(value.Clauses, CertifiedPredicateClauseDataV2.FromCore)
            };
        }

        private static TResult[] Select<TSource, TResult>(
            System.Collections.Generic.IReadOnlyList<TSource> values,
            Func<TSource, TResult> selector)
        {
            var result = new TResult[values.Count];
            for (int index = 0; index < values.Count; index += 1)
                result[index] = selector(values[index]);
            return result;
        }

        private static TResult[] Select<TSource, TResult>(
            TSource[] values,
            Func<TSource, TResult> selector)
        {
            values ??= Array.Empty<TSource>();
            var result = new TResult[values.Length];
            for (int index = 0; index < values.Length; index += 1)
            {
                if (values[index] == null)
                    throw new InvalidOperationException("Certified predicate arrays may not contain null records.");
                result[index] = selector(values[index]);
            }
            return result;
        }
    }

    [Serializable]
    internal sealed class CertifiedPredicateClauseDataV2
    {
        [SerializeField] private CertifiedPredicateConditionDataV2[] conditions =
            Array.Empty<CertifiedPredicateConditionDataV2>();

        public DungeonPredicateClauseV2 ToCore()
        {
            conditions ??= Array.Empty<CertifiedPredicateConditionDataV2>();
            var result = new DungeonPredicateConditionV2[conditions.Length];
            for (int index = 0; index < conditions.Length; index += 1)
            {
                if (conditions[index] == null)
                    throw new InvalidOperationException("Certified predicate conditions may not contain null records.");
                result[index] = conditions[index].ToCore();
            }
            return new DungeonPredicateClauseV2(result);
        }

        public static CertifiedPredicateClauseDataV2 FromCore(DungeonPredicateClauseV2 value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            var result = new CertifiedPredicateConditionDataV2[value.Conditions.Count];
            for (int index = 0; index < result.Length; index += 1)
                result[index] = CertifiedPredicateConditionDataV2.FromCore(value.Conditions[index]);
            return new CertifiedPredicateClauseDataV2 { conditions = result };
        }
    }

    [Serializable]
    internal sealed class CertifiedPredicateConditionDataV2
    {
        [SerializeField] private DungeonPredicateConditionKindV2 kind;
        [SerializeField] private string subjectId;
        [SerializeField] private DungeonPredicateOperatorV2 predicateOperator;
        [SerializeField] private string expectedValue;

        public DungeonPredicateConditionV2 ToCore()
        {
            return new DungeonPredicateConditionV2(
                kind,
                subjectId,
                predicateOperator,
                string.IsNullOrWhiteSpace(expectedValue) ? null : expectedValue);
        }

        public static CertifiedPredicateConditionDataV2 FromCore(DungeonPredicateConditionV2 value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            return new CertifiedPredicateConditionDataV2
            {
                kind = value.Kind,
                subjectId = value.SubjectId,
                predicateOperator = value.Operator,
                expectedValue = value.ExpectedValue
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
        [SerializeField] private CertifiedConnectorApertureDataV2 aperture;

        public CertifiedDungeonConnectorGeometryV2 ToCore()
        {
            return new CertifiedDungeonConnectorGeometryV2(
                id,
                regionId,
                kind,
                position.ToCore(),
                facing.ToCore(),
                socketTag,
                aperture != null
                    ? aperture.ToCore()
                    : BuildCompatibilityAperture());
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
                socketTag = value.SocketTag,
                aperture = CertifiedConnectorApertureDataV2.FromCore(value.Aperture)
            };
        }

        private DungeonConnectorApertureV2 BuildCompatibilityAperture()
        {
            // Old serialized assets are not accepted by schema 2, but keeping
            // reconstruction total produces a useful stale-schema diagnostic
            // instead of an unrelated null-reference failure in the inspector.
            DungeonPoint3 point = position.ToCore();
            DungeonPoint3 direction = facing.ToCore();
            bool xFacing = Math.Abs(direction.X) >= Math.Abs(direction.Z);
            double halfWidth = 1.25d;
            double halfDepth = 0.125d;
            DungeonConvexPrismV2 volume = xFacing
                ? CertifiedPrismDataV2.Box(
                    point.X - halfDepth, point.X + halfDepth,
                    point.Y - 0.5d, point.Y + 3.15d,
                    point.Z - halfWidth, point.Z + halfWidth)
                : CertifiedPrismDataV2.Box(
                    point.X - halfWidth, point.X + halfWidth,
                    point.Y - 0.5d, point.Y + 3.15d,
                    point.Z - halfDepth, point.Z + halfDepth);
            return new DungeonConnectorApertureV2(
                volume,
                socketTag,
                new[] { kind },
                "cap-" + socketTag);
        }
    }

    [Serializable]
    internal sealed class CertifiedRampWedgeDataV2
    {
        [SerializeField] private CertifiedPrismDataV2 boundingVolume;
        [SerializeField] private double lowSurfaceY;
        [SerializeField] private double highSurfaceY;
        [SerializeField] private CertifiedPoint3DataV2 riseDirection;

        public CertifiedDungeonRampWedgeV2 ToCore()
        {
            return new CertifiedDungeonRampWedgeV2(
                boundingVolume.ToCore(),
                lowSurfaceY,
                highSurfaceY,
                riseDirection.ToCore());
        }

        public static CertifiedRampWedgeDataV2 FromCore(CertifiedDungeonRampWedgeV2 value)
        {
            return value == null
                ? null
                : new CertifiedRampWedgeDataV2
                {
                    boundingVolume = CertifiedPrismDataV2.FromCore(value.BoundingVolume),
                    lowSurfaceY = value.LowSurfaceY,
                    highSurfaceY = value.HighSurfaceY,
                    riseDirection = CertifiedPoint3DataV2.FromCore(value.RiseDirection)
                };
        }
    }

    [Serializable]
    internal sealed class CertifiedConnectorApertureDataV2
    {
        [SerializeField] private CertifiedPrismDataV2 localVolume;
        [SerializeField] private string socketProfileId;
        [SerializeField] private DungeonConnectorKindV2[] compatibleConnectorKinds =
            Array.Empty<DungeonConnectorKindV2>();
        [SerializeField] private string themedCapProfileId;
        [SerializeField] private double floorElevation;
        [SerializeField] private double floorSlopeDegrees;
        [SerializeField] private CertifiedPrismDataV2 playerClearanceVolume;
        [SerializeField] private CertifiedPrismDataV2 cameraClearanceVolume;
        [SerializeField] private double seamDepth;
        [SerializeField] private CertifiedPrismDataV2 approachVolume;
        [SerializeField] private string navigationHandoffProfileId;
        [SerializeField] private DungeonConnectorCapStateV2 capState;
        [SerializeField] private string mechanismBindingId;
        [SerializeField] private string exteriorGasketProfileId;
        [SerializeField] private string verticalCompositionPortalId;

        public DungeonConnectorApertureV2 ToCore()
        {
            return new DungeonConnectorApertureV2(
                localVolume.ToCore(),
                socketProfileId,
                compatibleConnectorKinds,
                themedCapProfileId,
                floorElevation,
                floorSlopeDegrees,
                playerClearanceVolume.ToCore(),
                cameraClearanceVolume.ToCore(),
                seamDepth,
                approachVolume.ToCore(),
                navigationHandoffProfileId,
                capState,
                mechanismBindingId,
                exteriorGasketProfileId,
                verticalCompositionPortalId);
        }

        public static CertifiedConnectorApertureDataV2 FromCore(DungeonConnectorApertureV2 value)
        {
            if (value == null) return null;
            var kinds = new DungeonConnectorKindV2[value.CompatibleConnectorKinds.Count];
            for (int index = 0; index < kinds.Length; index += 1)
                kinds[index] = value.CompatibleConnectorKinds[index];
            return new CertifiedConnectorApertureDataV2
            {
                localVolume = CertifiedPrismDataV2.FromCore(value.LocalVolume),
                socketProfileId = value.SocketProfileId,
                compatibleConnectorKinds = kinds,
                themedCapProfileId = value.ThemedCapProfileId,
                floorElevation = value.FloorElevation,
                floorSlopeDegrees = value.FloorSlopeDegrees,
                playerClearanceVolume = CertifiedPrismDataV2.FromCore(value.PlayerClearanceVolume),
                cameraClearanceVolume = CertifiedPrismDataV2.FromCore(value.CameraClearanceVolume),
                seamDepth = value.SeamDepth,
                approachVolume = CertifiedPrismDataV2.FromCore(value.ApproachVolume),
                navigationHandoffProfileId = value.NavigationHandoffProfileId,
                capState = value.CapState,
                mechanismBindingId = value.MechanismBindingId,
                exteriorGasketProfileId = value.ExteriorGasketProfileId,
                verticalCompositionPortalId = value.VerticalCompositionPortalId
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

        internal static DungeonConvexPrismV2 Box(
            double minimumX,
            double maximumX,
            double minimumY,
            double maximumY,
            double minimumZ,
            double maximumZ)
        {
            return new DungeonConvexPrismV2(
                new[]
                {
                    new DungeonPoint2V2(minimumX, minimumZ),
                    new DungeonPoint2V2(maximumX, minimumZ),
                    new DungeonPoint2V2(maximumX, maximumZ),
                    new DungeonPoint2V2(minimumX, maximumZ)
                },
                minimumY,
                maximumY);
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
