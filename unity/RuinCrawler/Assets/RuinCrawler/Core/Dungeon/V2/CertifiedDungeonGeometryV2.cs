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
        ConvexMesh,
        RampWedge
    }

    /// <summary>
    /// Exact authored ramp contract. The bounding prism remains available to
    /// broad-phase solvers while the high/low edge and rise direction preserve
    /// the sloped collision surface for the Unity bake/runtime adapter.
    /// </summary>
    public sealed class CertifiedDungeonRampWedgeV2
    {
        public CertifiedDungeonRampWedgeV2(
            DungeonConvexPrismV2 boundingVolume,
            double lowSurfaceY,
            double highSurfaceY,
            DungeonPoint3 riseDirection)
        {
            DungeonV2Contract.RequireFinite(lowSurfaceY, nameof(lowSurfaceY));
            DungeonV2Contract.RequireFinite(highSurfaceY, nameof(highSurfaceY));
            if (highSurfaceY <= lowSurfaceY)
                throw new ArgumentOutOfRangeException(nameof(highSurfaceY), "Ramp high edge must exceed its low edge.");
            if (boundingVolume == null) throw new ArgumentNullException(nameof(boundingVolume));
            if (lowSurfaceY < boundingVolume.MinimumY || highSurfaceY > boundingVolume.MaximumY)
                throw new ArgumentException("Ramp surface heights must stay within the certified bounding prism.");
            if (Math.Abs(riseDirection.Y) > 1e-9d)
                throw new ArgumentException("Ramp rise direction must be horizontal.", nameof(riseDirection));
            double magnitude = Math.Sqrt(
                riseDirection.X * riseDirection.X + riseDirection.Z * riseDirection.Z);
            if (magnitude <= 1e-9d)
                throw new ArgumentException("Ramp rise direction may not be zero.", nameof(riseDirection));

            BoundingVolume = boundingVolume;
            LowSurfaceY = lowSurfaceY;
            HighSurfaceY = highSurfaceY;
            RiseDirection = new DungeonPoint3(
                riseDirection.X / magnitude,
                0d,
                riseDirection.Z / magnitude);
        }

        public DungeonConvexPrismV2 BoundingVolume { get; }
        public double LowSurfaceY { get; }
        public double HighSurfaceY { get; }
        public DungeonPoint3 RiseDirection { get; }
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
            : this(
                id,
                regionId,
                kind,
                colliderKind,
                volume,
                null,
                isStructural,
                isWalkable,
                materialProfileId,
                DungeonAccessPredicateV2.Always,
                null)
        {
        }

        public CertifiedDungeonSurfaceGeometryV2(
            string id,
            string regionId,
            DungeonSurfaceKindV2 kind,
            CertifiedDungeonColliderKindV2 colliderKind,
            DungeonConvexPrismV2 volume,
            CertifiedDungeonRampWedgeV2 rampWedge,
            bool isStructural,
            bool isWalkable,
            string materialProfileId,
            DungeonAccessPredicateV2 activePredicate = null,
            string controllerId = null)
        {
            if (kind == DungeonSurfaceKindV2.Walkable && !isWalkable)
            {
                throw new ArgumentException("Walkable surface geometry must be marked walkable.", nameof(isWalkable));
            }

            if (colliderKind == CertifiedDungeonColliderKindV2.RampWedge && rampWedge == null)
                throw new ArgumentException("Ramp-wedge colliders require exact ramp geometry.", nameof(rampWedge));
            if (colliderKind != CertifiedDungeonColliderKindV2.RampWedge && rampWedge != null)
                throw new ArgumentException("Exact ramp geometry is only valid for RampWedge colliders.", nameof(rampWedge));
            if (rampWedge != null && !PrismExactlyEqual(volume, rampWedge.BoundingVolume))
                throw new ArgumentException("Ramp bounding volume must equal the surface volume.", nameof(volume));

            Id = DungeonV2Contract.RequireId(id, nameof(id));
            RegionId = DungeonV2Contract.RequireId(regionId, nameof(regionId));
            Kind = kind;
            ColliderKind = colliderKind;
            Volume = volume ?? throw new ArgumentNullException(nameof(volume));
            RampWedge = rampWedge;
            IsStructural = isStructural;
            IsWalkable = isWalkable;
            MaterialProfileId = DungeonV2Contract.RequireId(materialProfileId, nameof(materialProfileId));
            ActivePredicate = activePredicate ?? DungeonAccessPredicateV2.Always;
            ControllerId = DungeonV2Contract.OptionalId(controllerId, nameof(controllerId));
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonSurfaceKindV2 Kind { get; }
        public CertifiedDungeonColliderKindV2 ColliderKind { get; }
        public DungeonConvexPrismV2 Volume { get; }
        public CertifiedDungeonRampWedgeV2 RampWedge { get; }
        public bool IsStructural { get; }
        public bool IsWalkable { get; }
        public string MaterialProfileId { get; }
        public DungeonAccessPredicateV2 ActivePredicate { get; }
        public string ControllerId { get; }

        private static bool PrismExactlyEqual(DungeonConvexPrismV2 left, DungeonConvexPrismV2 right)
        {
            if (left == null || right == null
                || left.MinimumY != right.MinimumY
                || left.MaximumY != right.MaximumY
                || left.HorizontalVertices.Count != right.HorizontalVertices.Count)
                return false;
            for (int index = 0; index < left.HorizontalVertices.Count; index += 1)
            {
                if (!left.HorizontalVertices[index].Equals(right.HorizontalVertices[index])) return false;
            }
            return true;
        }
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
            : this(
                id,
                regionId,
                kind,
                position,
                facing,
                socketTag,
                BuildDefaultAperture(position, facing, kind, socketTag))
        {
        }

        public CertifiedDungeonConnectorGeometryV2(
            string id,
            string regionId,
            DungeonConnectorKindV2 kind,
            DungeonPoint3 position,
            DungeonPoint3 facing,
            string socketTag,
            DungeonConnectorApertureV2 aperture)
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
            Aperture = aperture ?? throw new ArgumentNullException(nameof(aperture));
            if (!Aperture.Accepts(kind, SocketTag))
                throw new ArgumentException("Connector kind/profile is incompatible with its certified aperture.", nameof(aperture));
        }

        public string Id { get; }
        public string RegionId { get; }
        public DungeonConnectorKindV2 Kind { get; }
        public DungeonPoint3 Position { get; }
        public DungeonPoint3 Facing { get; }
        public string SocketTag { get; }
        public DungeonConnectorApertureV2 Aperture { get; }

        private static DungeonConnectorApertureV2 BuildDefaultAperture(
            DungeonPoint3 position,
            DungeonPoint3 facing,
            DungeonConnectorKindV2 kind,
            string socketTag)
        {
            double halfWidth = 1.25d;
            double halfDepth = 0.125d;
            bool xFacing = Math.Abs(facing.X) >= Math.Abs(facing.Z);
            DungeonConvexPrismV2 volume = xFacing
                ? Box(position.X - halfDepth, position.X + halfDepth,
                    position.Y - 0.5d, position.Y + 3.15d,
                    position.Z - halfWidth, position.Z + halfWidth)
                : Box(position.X - halfWidth, position.X + halfWidth,
                    position.Y - 0.5d, position.Y + 3.15d,
                    position.Z - halfDepth, position.Z + halfDepth);
            return new DungeonConnectorApertureV2(
                volume,
                socketTag,
                new[] { kind },
                "cap-" + socketTag);
        }

        private static DungeonConvexPrismV2 Box(
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
        public const int CurrentSchemaVersion = 2;

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
            // Anchor semantics such as entry/exit/safe are local to a region.
            // Multi-region authored modules intentionally repeat those local
            // IDs; placement prefixes the placed region, producing globally
            // stable plan IDs without forcing author-facing name mangling.
            Anchors = DungeonV2Contract.CopyCanonical(
                anchors,
                value => value.RegionId + "\u001f" + value.Id,
                nameof(anchors));
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

            return new CertifiedDungeonGeometryValidationResultV2(
                CertifiedDungeonGeometryValidationCodeV2.Valid,
                "Certified geometry matches the module template. Combined revision identity is validated by the authored module registry.");
        }

        public CertifiedDungeonGeometryValidationResultV2 ValidateGeometryRevision(
            string expectedGeometryRevisionHash)
        {
            expectedGeometryRevisionHash = DungeonV2Contract.RequireId(
                expectedGeometryRevisionHash,
                nameof(expectedGeometryRevisionHash));
            if (!string.Equals(expectedGeometryRevisionHash, ContentHash, StringComparison.Ordinal))
            {
                return new CertifiedDungeonGeometryValidationResultV2(
                    CertifiedDungeonGeometryValidationCodeV2.ContentHashMismatch,
                    "Certified geometry for '" + TemplateId + "' is stale. Expected "
                        + expectedGeometryRevisionHash + ", bake provides " + ContentHash + ".");
            }
            return new CertifiedDungeonGeometryValidationResultV2(
                CertifiedDungeonGeometryValidationCodeV2.Valid,
                "Certified geometry revision matches.");
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
                writer.Add(surface.ControllerId);
                writer.Add(surface.ActivePredicate.Clauses.Count);
                foreach (DungeonPredicateClauseV2 clause in surface.ActivePredicate.Clauses)
                {
                    writer.Add(clause.Conditions.Count);
                    foreach (DungeonPredicateConditionV2 condition in clause.Conditions)
                    {
                        writer.Add((int)condition.Kind);
                        writer.Add(condition.SubjectId);
                        writer.Add((int)condition.Operator);
                        writer.Add(condition.ExpectedValue);
                    }
                }
                writer.Add(surface.Volume);
                writer.Add(surface.RampWedge != null);
                if (surface.RampWedge != null)
                {
                    writer.Add(surface.RampWedge.LowSurfaceY);
                    writer.Add(surface.RampWedge.HighSurfaceY);
                    writer.Add(surface.RampWedge.RiseDirection);
                }
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
                writer.Add(connector.Aperture.LocalVolume);
                writer.Add(connector.Aperture.SocketProfileId);
                writer.Add(connector.Aperture.ThemedCapProfileId);
                writer.Add(connector.Aperture.FloorElevation);
                writer.Add(connector.Aperture.FloorSlopeDegrees);
                writer.Add(connector.Aperture.PlayerClearanceVolume);
                writer.Add(connector.Aperture.CameraClearanceVolume);
                writer.Add(connector.Aperture.SeamDepth);
                writer.Add(connector.Aperture.ApproachVolume);
                writer.Add(connector.Aperture.NavigationHandoffProfileId);
                writer.Add((int)connector.Aperture.CapState);
                writer.Add(connector.Aperture.MechanismBindingId);
                writer.Add(connector.Aperture.ExteriorGasketProfileId);
                writer.Add(connector.Aperture.VerticalCompositionPortalId);
                writer.Add(connector.Aperture.CompatibleConnectorKinds.Count);
                foreach (DungeonConnectorKindV2 kind in connector.Aperture.CompatibleConnectorKinds)
                    writer.Add((int)kind);
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
