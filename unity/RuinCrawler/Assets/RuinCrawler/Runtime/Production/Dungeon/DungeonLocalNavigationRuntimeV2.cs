using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.AI;

namespace RuinCrawler.Runtime.Dungeon
{
    /// <summary>
    /// One bounded local NavMesh surface for a DungeonPlanV2 navigation region.
    /// Cross-region reasoning remains plan-driven; this component only gives
    /// grounded runtime agents a local acceleration structure whose identity is
    /// the plan's immutable LocalNavigationRegionId.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class DungeonLocalNavigationRuntimeV2 : MonoBehaviour
    {
        private NavMeshSurface surface;
        private IReadOnlyList<string> regionIds = Array.Empty<string>();
        private DungeonEnvironmentRuntimeV2 environment;
        private bool rebuildOnEnvironmentChanges;

        public string LocalNavigationRegionId { get; private set; }
        public IReadOnlyList<string> RegionIds => regionIds;
        public NavMeshSurface Surface => surface;
        public bool HasBakedData => surface != null && surface.navMeshData != null;

        internal void Configure(
            string localNavigationRegionId,
            IEnumerable<string> sourceRegionIds,
            Vector3 volumeCenter,
            Vector3 volumeSize,
            int worldGeometryLayer,
            bool bakeImmediately,
            DungeonEnvironmentRuntimeV2 runtimeEnvironment)
        {
            if (string.IsNullOrWhiteSpace(localNavigationRegionId))
            {
                throw new ArgumentException(
                    "A stable local navigation region ID is required.",
                    nameof(localNavigationRegionId));
            }

            string[] canonicalRegionIds = (sourceRegionIds ?? Array.Empty<string>())
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            if (canonicalRegionIds.Length == 0)
            {
                throw new ArgumentException(
                    "At least one stable dungeon region ID is required.",
                    nameof(sourceRegionIds));
            }

            if (volumeSize.x <= 0f || volumeSize.y <= 0f || volumeSize.z <= 0f)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(volumeSize),
                    "Local navigation volume dimensions must be positive.");
            }

            UnbindEnvironment();
            ReleaseData();
            LocalNavigationRegionId = localNavigationRegionId.Trim();
            regionIds = Array.AsReadOnly(canonicalRegionIds);
            transform.position = volumeCenter;
            surface = GetComponent<NavMeshSurface>();
            if (surface == null)
            {
                surface = gameObject.AddComponent<NavMeshSurface>();
            }

            surface.collectObjects = CollectObjects.Volume;
            surface.center = Vector3.zero;
            surface.size = volumeSize;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            surface.layerMask = worldGeometryLayer >= 0 ? 1 << worldGeometryLayer : ~0;
            rebuildOnEnvironmentChanges = bakeImmediately && runtimeEnvironment != null;
            environment = rebuildOnEnvironmentChanges ? runtimeEnvironment : null;
            if (bakeImmediately)
            {
                Rebuild();
            }

            BindEnvironment();
        }

        public void Rebuild()
        {
            if (surface == null || !isActiveAndEnabled)
            {
                return;
            }

            ReleaseData();
            surface.BuildNavMesh();
        }

        public void ReleaseData()
        {
            if (surface != null && surface.navMeshData != null)
            {
                NavMeshData ownedData = surface.navMeshData;
                surface.RemoveData();
                surface.navMeshData = null;
                if (Application.isPlaying)
                {
                    Destroy(ownedData);
                }
                else
                {
                    DestroyImmediate(ownedData);
                }
            }
        }

        internal void ReleaseOwnedResources()
        {
            UnbindEnvironment();
            rebuildOnEnvironmentChanges = false;
            ReleaseData();
        }

        private void BindEnvironment()
        {
            if (environment == null || !rebuildOnEnvironmentChanges)
            {
                return;
            }

            environment.CommittedStateChanged -= HandleEnvironmentStateChanged;
            environment.CommittedStateChanged += HandleEnvironmentStateChanged;
        }

        private void UnbindEnvironment()
        {
            if (environment != null)
            {
                environment.CommittedStateChanged -= HandleEnvironmentStateChanged;
            }

            environment = null;
        }

        private void HandleEnvironmentStateChanged(DungeonEnvironmentSnapshotV2 _)
        {
            // Environment commits apply predicate bindings before publishing the
            // event, so a synchronous rebuild sees the new collider topology.
            if (rebuildOnEnvironmentChanges && isActiveAndEnabled)
            {
                Rebuild();
            }
        }

        private void OnDestroy()
        {
            ReleaseOwnedResources();
        }
    }
}
