using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonConnectorGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string stableId = "connector-v2";
        [SerializeField] private string regionId = "region-v2";
        [SerializeField] private DungeonConnectorKindV2 kind = DungeonConnectorKindV2.Ground;
        [SerializeField] private string socketTag = "factory-ground-v2";
        [SerializeField] private Vector3 localApertureCenter = new Vector3(0f, 1.325f, 0f);
        [SerializeField] private Vector3 localApertureSize = new Vector3(2.5f, 3.65f, 0.25f);
        [SerializeField] private DungeonConnectorKindV2[] compatibleKinds =
            { DungeonConnectorKindV2.Ground };
        [SerializeField] private string themedCapProfileId = "cap-factory-ground-v2";
        [SerializeField] private GameObject themedCapPrefab;
        [SerializeField] private float floorElevation;
        [SerializeField, Range(-45f, 45f)] private float floorSlopeDegrees;
        [SerializeField] private Vector3 localPlayerClearanceCenter = new Vector3(0f, 1.325f, 0f);
        [SerializeField] private Vector3 localPlayerClearanceSize = new Vector3(2.5f, 3.65f, 0.5f);
        [SerializeField] private Vector3 localCameraClearanceCenter = new Vector3(0f, 2f, 0f);
        [SerializeField] private Vector3 localCameraClearanceSize = new Vector3(3.5f, 5f, 1f);
        [SerializeField, Min(0f)] private float seamDepth = 0.25f;
        [SerializeField] private Vector3 localApproachCenter = new Vector3(0f, 1.5f, -1.5f);
        [SerializeField] private Vector3 localApproachSize = new Vector3(3f, 4f, 3f);
        [SerializeField] private string navigationHandoffProfileId = "navigation-factory-ground-v2";
        [SerializeField] private DungeonConnectorCapStateV2 capState =
            DungeonConnectorCapStateV2.RequiredWhenUnused;
        [SerializeField] private string mechanismBindingId;
        [SerializeField] private string exteriorGasketProfileId = "gasket-factory-ground-v2";
        [SerializeField] private string verticalCompositionPortalId;

        public string StableId => stableId;
        public string RegionId => regionId;
        public DungeonConnectorKindV2 Kind => kind;
        public string SocketTag => socketTag;
        public Vector3 LocalApertureCenter => localApertureCenter;
        public Vector3 LocalApertureSize => localApertureSize;
        public IReadOnlyList<DungeonConnectorKindV2> CompatibleKinds => compatibleKinds;
        public string ThemedCapProfileId => themedCapProfileId;
        public GameObject ThemedCapPrefab => themedCapPrefab;
        public float FloorElevation => floorElevation;
        public float FloorSlopeDegrees => floorSlopeDegrees;
        public Vector3 LocalPlayerClearanceCenter => localPlayerClearanceCenter;
        public Vector3 LocalPlayerClearanceSize => localPlayerClearanceSize;
        public Vector3 LocalCameraClearanceCenter => localCameraClearanceCenter;
        public Vector3 LocalCameraClearanceSize => localCameraClearanceSize;
        public float SeamDepth => seamDepth;
        public Vector3 LocalApproachCenter => localApproachCenter;
        public Vector3 LocalApproachSize => localApproachSize;
        public string NavigationHandoffProfileId => navigationHandoffProfileId;
        public DungeonConnectorCapStateV2 CapState => capState;
        public string MechanismBindingId => string.IsNullOrWhiteSpace(mechanismBindingId) ? null : mechanismBindingId;
        public string ExteriorGasketProfileId => exteriorGasketProfileId;
        public string VerticalCompositionPortalId => string.IsNullOrWhiteSpace(verticalCompositionPortalId)
            ? null
            : verticalCompositionPortalId;

        public void Configure(
            string id,
            string owningRegionId,
            DungeonConnectorKindV2 connectorKind,
            string connectorSocketTag)
        {
            stableId = id;
            regionId = owningRegionId;
            kind = connectorKind;
            socketTag = connectorSocketTag;
            compatibleKinds = new[] { connectorKind };
            themedCapProfileId = "cap-" + connectorSocketTag;
            navigationHandoffProfileId = "navigation-handoff-" + connectorSocketTag;
            exteriorGasketProfileId = "gasket-" + connectorSocketTag;
        }

        public void ConfigureAperture(
            Vector3 center,
            Vector3 size,
            IEnumerable<DungeonConnectorKindV2> compatibleConnectorKinds,
            string capProfileId)
        {
            localApertureCenter = center;
            localApertureSize = size;
            compatibleKinds = (compatibleConnectorKinds ?? Array.Empty<DungeonConnectorKindV2>())
                .Distinct()
                .OrderBy(value => (int)value)
                .ToArray();
            themedCapProfileId = capProfileId;
        }

        public void ConfigureCertification(
            float certifiedFloorElevation,
            float certifiedFloorSlopeDegrees,
            Vector3 playerClearanceCenter,
            Vector3 playerClearanceSize,
            Vector3 cameraClearanceCenter,
            Vector3 cameraClearanceSize,
            float certifiedSeamDepth,
            Vector3 approachCenter,
            Vector3 approachSize,
            string navigationProfileId,
            DungeonConnectorCapStateV2 certifiedCapState,
            GameObject capPrefab,
            string certifiedMechanismBindingId,
            string gasketProfileId,
            string certifiedVerticalCompositionPortalId)
        {
            floorElevation = certifiedFloorElevation;
            floorSlopeDegrees = certifiedFloorSlopeDegrees;
            localPlayerClearanceCenter = playerClearanceCenter;
            localPlayerClearanceSize = playerClearanceSize;
            localCameraClearanceCenter = cameraClearanceCenter;
            localCameraClearanceSize = cameraClearanceSize;
            seamDepth = certifiedSeamDepth;
            localApproachCenter = approachCenter;
            localApproachSize = approachSize;
            navigationHandoffProfileId = navigationProfileId;
            capState = certifiedCapState;
            themedCapPrefab = capPrefab;
            mechanismBindingId = certifiedMechanismBindingId;
            exteriorGasketProfileId = gasketProfileId;
            verticalCompositionPortalId = certifiedVerticalCompositionPortalId;
        }
    }
}
