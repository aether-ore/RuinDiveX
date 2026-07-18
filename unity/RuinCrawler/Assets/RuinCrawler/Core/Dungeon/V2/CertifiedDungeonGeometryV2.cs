using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace RuinCrawler.Core.Dungeon.V2
{
    /// <summary>
    /// Collider families that the V2 module baker can prove equivalent to a
    /// vertical convex prism. Unsupported collider types are rejected instead
    /// of being approximated silently.
    /// </summary>
    public enum CertifiedDungeonColliderKindV2
    {
        Box,
        ConvexMesh
    }

    public sealed class CertifiedDungeonSurfaceGeometryV2
    {
        public CertifiedDungeonSurfaceGeometryV2(
            string id,
            string regionId,
            DungeonSurfaceKindV2 kind,
            CertifiedDungeonColliderKindV2 colliderKind,
            DungeonConvexPrismV2 volume,
            bool isStructural,
            bool isWalkable,
            string materialProfileId)
        {
            if (kind == DungeonSurfaceKindV2.Walkable && !isWalkable)
            {
                throw new ArgumentException("Walkable surface geometry must be marked walkable.", nameof(isWalkable));
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            ColliderKind = colliderKind;
            Volume = volume ?? throw new ArgumentNullException(nameof(volume));
            IsStructural = isStructural;
            IsWalkable = isWalkable;
            MaterialProfileId = DungeonV2Contract.RequireId(materialProfileId, nameof(materialProfileId));
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonSurfaceKindV2 Kind { get; }
        public CertifiedDungeonColliderKindV2 ColliderKind { get; }
        public DungeonConvexPrismV2 Volume { get; }
        public bool IsStructural { get; }
        public bool IsWalkable { get; }
        public string MaterialProfileId { get; }
    }

    public sealed class CertifiedDungeonRegionGeometryV2
    {
        public CertifiedDungeonRegionGeometryV2(
            string id,
            DungeonBounds3 bounds,
            DungeonBiomeDistrictKindV2 districtKind,
            DungeonElevationStratumV2 elevationStratum,
            string localNavigationRegionId)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            Bounds = bounds;
            DistrictKind = districtKind;
            ElevationStratum = elevationStratum;
            LocalNavigationRegionId = DungeonV2Contract.RequireId(
                localNavigationRegionId,
                nameof(localNavigationRegionId));
        }

        public string Id { get; }
        public DungeonBounds3 Bounds { get; }
        public DungeonBiomeDistrictKindV2 DistrictKind { get; }
        public DungeonElevationStratumV2 ElevationStratum { get; }
        public string LocalNavigationRegionId { get; }
    }

    public sealed class CertifiedDungeonAnchorGeometryV2
    {
        public CertifiedDungeonAnchorGeometryV2(
            string id,
            string regionId,
            DungeonAnchorKindV2 kind,
            DungeonPoint3 position,
            string profileId = null)
        {
            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            Position = position;
            ProfileId = DungeonV2Contract.OptionalId(profileId, nameof(profileId));
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonAnchorKindV2 Kind { get; }
        public DungeonPoint3 Position { get; }
        public string ProfileId { get; }
    }

    public sealed class CertifiedDungeonConnectorGeometryV2
    {
        public CertifiedDungeonConnectorGeometryV2(
            string id,
            string regionId,
            DungeonConnectorKindV2 kind,
            DungeonPoint3 position,
            DungeonPoint3 facing,
            string socketTag)
        {
            if (facing == DungeonPoint3.Zero)
            {
                throw new ArgumentException("Connector facing may not be the zero vector.", nameof(facing));
            }

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            Position = position;
            Facing = facing;
            SocketTag = DungeonV2Contract.RequireId(socketTag, nameof(socketTag));
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public DungeonPoint3 Position { get; }
        public DungeonPoint3 Facing { get; }
        public string SocketTag { get; }
    }

    public enum CertifiedDungeonGeometryValidationCodeV2
    {
        Valid,
        TemplateMismatch,
        ContentHashMismatch
    }

    public sealed class CertifiedDungeonGeometryValidationResultV2
    {
        public CertifiedDungeonGeometryValidationResultV2(
            CertifiedDungeonGeometryValidationCodeV2 code,
            string message)
        {
            Code = code;
            Message = message ?? string.Empty;
        }

        public CertifiedDungeonGeometryValidationCodeV2 Code { get; }
        public string Message { get; }
        public bool IsValid => Code == CertifiedDungeonGeometryValidationCodeV2.Valid;
    }

    /// <summary>
    /// Immutable, Unity-independent output of the certified module baker. All
    /// collections are canonicalized by stable ID before the content hash is
    /// calculated, so hierarchy order and editor selection order are irrelevant.
    /// </summary>
    public sealed class CertifiedDungeonModuleGeometryV2
    {
        public const int CurrentSchemaVersion = 1;

        public CertifiedDungeonModuleGeometryV2(
            string templateId,
            IEnumerable<CertifiedDungeonSurfaceGeometryV2> surfaces,
            IEnumerable<CertifiedDungeonRegionGeometryV2> regions,
            IEnumerable<CertifiedDungeonAnchorGeometryV2> anchors,
            IEnumerable<CertifiedDungeonConnectorGeometryV2> connectors)
        {
            TemplateId = DungeonV2Contract.RequireId(templateId, nameof(templateId));
            Surfaces = DungeonV2Contract.CopyCanonical(surfaces, value => value.Id, nameof(surfaces), minimumCount: 1);
            Regions = DungeonV2Contract.CopyCanonical(regions, value => value.Id, nameof(regions), minimumCount: 1);
            Anchors = DungeonV2Contract.CopyCanonical(anchors, value => value.Id, nameof(anchors));
            Connectors = DungeonV2Contract.CopyCanonical(connectors, value => value.Id, nameof(connectors));
            ValidateReferences();
            CanonicalContent = BuildCanonicalContent();
            ContentHash = ComputeSha256(CanonicalContent);
        }

        public int SchemaVersion => CurrentSchemaVersion;
        public string TemplateId { get; }
        public IReadOnlyList<CertifiedDungeonSurfaceGeometryV2> Surfaces { get; }
        public IReadOnlyList<CertifiedDungeonRegionGeometryV2> Regions { get; }
        public IReadOnlyList<CertifiedDungeonAnchorGeometryV2> Anchors { get; }
        public IReadOnlyList<CertifiedDungeonConnectorGeometryV2> Connectors { get; }
        public string CanonicalContent { get; }
        public string ContentHash { get; }

        public CertifiedDungeonGeometryValidationResultV2 ValidateModuleInstance(
            DungeonModuleInstancePlanV2 module)
        {
            if (module == null)
            {
                throw new ArgumentNullException(nameof(module));
            }

            if (!string.Equals(module.TemplateId, TemplateId, StringComparison.Ordinal))
            {
                return new CertifiedDungeonGeometryValidationResultV2(
                    CertifiedDungeonGeometryValidationCodeV2.TemplateMismatch,
                    "Certified geometry template '" + TemplateId + "' cannot satisfy module template '"
                        + module.TemplateId + "'.");
            }

            if (!string.Equals(module.ContentHash, ContentHash, StringComparison.Ordinal))
            {
                return new CertifiedDungeonGeometryValidationResultV2(
                    CertifiedDungeonGeometryValidationCodeV2.ContentHashMismatch,
                    "Certified geometry for '" + TemplateId + "' is stale or belongs to a different content revision. "
                        + "Plan expects " + module.ContentHash + ", bake provides " + ContentHash + ".");
            }

            return new CertifiedDungeonGeometryValidationResultV2(
                CertifiedDungeonGeometryValidationCodeV2.Valid,
                "Certified geometry matches the module template and content hash.");
        }

        private void ValidateReferences()
        {
            var regionIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (CertifiedDungeonRegionGeometryV2 region in Regions)
            {
                regionIds.Add(region.Id);
            }

            foreach (CertifiedDungeonSurfaceGeometryV2 surface in Surfaces)
            {
                RequireRegion(regionIds, surface.RegionId, "surface", surface.Id);
            }

            foreach (CertifiedDungeonAnchorGeometryV2 anchor in Anchors)
            {
                RequireRegion(regionIds, anchor.RegionId, "anchor", anchor.Id);
            }

            foreach (CertifiedDungeonConnectorGeometryV2 connector in Connectors)
            {
                RequireRegion(regionIds, connector.RegionId, "connector", connector.Id);
            }
        }

        private string BuildCanonicalContent()
        {
            var writer = new CertifiedGeometrySignatureWriterV2();
            writer.Add(CurrentSchemaVersion);
            writer.Add(TemplateId);
            writer.Add(Surfaces.Count);
            foreach (CertifiedDungeonSurfaceGeometryV2 surface in Surfaces)
            {
                writer.Add(surface.Id);
                writer.Add(surface.RegionId);
                writer.Add((int)surface.Kind);
                writer.Add((int)surface.ColliderKind);
                writer.Add(surface.IsStructural);
                writer.Add(surface.IsWalkable);
                writer.Add(surface.MaterialProfileId);
                writer.Add(surface.Volume);
            }

            writer.Add(Regions.Count);
            foreach (CertifiedDungeonRegionGeometryV2 region in Regions)
            {
                writer.Add(region.Id);
                writer.Add((int)region.DistrictKind);
                writer.Add((int)region.ElevationStratum);
                writer.Add(region.LocalNavigationRegionId);
                writer.Add(region.Bounds.Minimum);
                writer.Add(region.Bounds.Maximum);
            }

            writer.Add(Anchors.Count);
            foreach (CertifiedDungeonAnchorGeometryV2 anchor in Anchors)
            {
                writer.Add(anchor.Id);
                writer.Add(anchor.RegionId);
                writer.Add((int)anchor.Kind);
                writer.Add(anchor.Position);
                writer.Add(anchor.ProfileId);
            }

            writer.Add(Connectors.Count);
            foreach (CertifiedDungeonConnectorGeometryV2 connector in Connectors)
            {
                writer.Add(connector.Id);
                writer.Add(connector.RegionId);
                writer.Add((int)connector.Kind);
                writer.Add(connector.Position);
                writer.Add(connector.Facing);
                writer.Add(connector.SocketTag);
            }

            return writer.ToString();
        }

        private static string ComputeSha256(string value)
        {
            byte[] data = Encoding.UTF8.GetBytes(value);
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(data);
                var builder = new StringBuilder(7 + digest.Length * 2);
                builder.Append("sha256:");
                foreach (byte item in digest)
                {
                    builder.Append(item.ToString("x2", CultureInfo.InvariantCulture));
                }

                return builder.ToString();
            }
        }

        private static void RequireRegion(
            HashSet<string> regionIds,
            string regionId,
            string recordKind,
            string recordId)
        {
            if (!regionIds.Contains(regionId))
            {
                throw new ArgumentException(
                    "Certified " + recordKind + " '" + recordId + "' references unknown region '" + regionId + "'.");
            }
        }
    }

    internal sealed class CertifiedGeometrySignatureWriterV2
    {
        private readonly StringBuilder builder = new StringBuilder(2048);

        public void Add(string value)
        {
            if (value == null)
            {
                builder.Append("-1:|");
                return;
            }

            builder.Append(value.Length).Append(':').Append(value).Append('|');
        }

        public void Add(int value) => builder.Append(value.ToString(CultureInfo.InvariantCulture)).Append('|');
        public void Add(bool value) => builder.Append(value ? '1' : '0').Append('|');
        public void Add(double value) => builder.Append(value.ToString("R", CultureInfo.InvariantCulture)).Append('|');

        public void Add(DungeonPoint3 point)
        {
            Add(point.X);
            Add(point.Y);
            Add(point.Z);
        }

        public void Add(DungeonConvexPrismV2 prism)
        {
            Add(prism.HorizontalVertices.Count);
            foreach (DungeonPoint2V2 point in prism.HorizontalVertices)
            {
                Add(point.X);
                Add(point.Z);
            }

            Add(prism.MinimumY);
            Add(prism.MaximumY);
        }

        public override string ToString() => builder.ToString();
    }
}
