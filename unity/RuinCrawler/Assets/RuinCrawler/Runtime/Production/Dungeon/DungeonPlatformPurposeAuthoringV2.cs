using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonPlatformPurposeAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "platform-v2";
        [SerializeField] private DungeonPlatformPurposeV2 purpose;
        [SerializeField] private string targetBindingId = "route-target-v2";
        [SerializeField] private DungeonSurfaceGeometryAuthoringV2 certifiedSurface;
        [SerializeField] private DungeonStructuralSupportAuthoringV2[] supports =
            Array.Empty<DungeonStructuralSupportAuthoringV2>();

        public string StableId => stableId;
        public DungeonPlatformPurposeV2 Purpose => purpose;
        public string TargetBindingId => targetBindingId;
        public DungeonSurfaceGeometryAuthoringV2 CertifiedSurface => certifiedSurface;
        public IReadOnlyList<DungeonStructuralSupportAuthoringV2> Supports => supports;

        public void Configure(
            string id,
            DungeonPlatformPurposeV2 platformPurpose,
            IEnumerable<DungeonStructuralSupportAuthoringV2> visibleSupports)
        {
            Configure(
                id,
                platformPurpose,
                platformPurpose == DungeonPlatformPurposeV2.ObservationOnly ? null : id,
                null,
                visibleSupports);
        }

        public void Configure(
            string id,
            DungeonPlatformPurposeV2 platformPurpose,
            string stableTargetBindingId,
            DungeonSurfaceGeometryAuthoringV2 targetSurface,
            IEnumerable<DungeonStructuralSupportAuthoringV2> visibleSupports)
        {
            stableId = id;
            purpose = platformPurpose;
            targetBindingId = stableTargetBindingId;
            certifiedSurface = targetSurface;
            supports = (visibleSupports ?? Array.Empty<DungeonStructuralSupportAuthoringV2>())
                .Where(value => value != null)
                .Distinct()
                .ToArray();
        }

        public DungeonPlatformPurposeBindingV2 ToCore()
        {
            return new DungeonPlatformPurposeBindingV2(stableId, purpose, targetBindingId);
        }
    }
}
