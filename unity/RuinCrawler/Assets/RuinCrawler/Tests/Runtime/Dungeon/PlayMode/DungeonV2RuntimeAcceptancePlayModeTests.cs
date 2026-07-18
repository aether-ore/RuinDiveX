using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonV2RuntimeAcceptancePlayModeTests
    {
        [UnityTest]
        public IEnumerator GoldenPlansBuildBothUndercroftsAndCertifiedFluidVolumes()
        {
            var host = new GameObject("DungeonV2BothUndercroftsAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                foreach (DungeonBiomeDistrictKindV2 hazardKind in HazardKinds)
                {
                    DungeonPlanV2 plan = GeneratePlan(hazardKind);
                    Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                    DungeonSceneInstanceV2 instance = builder.CurrentInstance;

                    Assert.That(instance, Is.Not.Null);
                    Assert.That(instance.RegionCount, Is.EqualTo(plan.Regions.Count));
                    Assert.That(instance.SurfaceCount, Is.EqualTo(plan.Surfaces.Count));
                    Assert.That(instance.FluidZoneCount, Is.EqualTo(plan.FluidZones.Count));
                    Assert.That(instance.AnchorCount, Is.EqualTo(plan.Anchors.Count));
                    Assert.That(instance.HazardSurfaceCount,
                        Is.EqualTo(plan.Surfaces.Count(surface => surface.Kind == DungeonSurfaceKindV2.Hazard)));
                    Assert.That(instance.Fallback, Is.Not.Null);

                    DungeonHazardSurfaceRuntimeV2[] hazards = instance.Root
                        .GetComponentsInChildren<DungeonHazardSurfaceRuntimeV2>(true);
                    DungeonHazardSurfaceKindV2 expected = hazardKind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                        ? DungeonHazardSurfaceKindV2.Magma
                        : DungeonHazardSurfaceKindV2.Electric;
                    Assert.That(hazards, Is.Not.Empty);
                    Assert.That(hazards.All(hazard => hazard.Kind == expected), Is.True);

                    PlayerTraversalMediumVolume[] volumes = instance.Root
                        .GetComponentsInChildren<PlayerTraversalMediumVolume>(true);
                    Assert.That(volumes.Select(volume => volume.StableId),
                        Is.EquivalentTo(plan.FluidZones.Select(zone => zone.Id)));
                    Assert.That(volumes.All(volume =>
                        volume.Medium == PlayerTraversalMediumKind.FloodedBottomWalk), Is.True);
                    AssertActiveFluidConfiguration(instance, IndustrialFactoryV2Ruleset.FreightSumpFilled);

                    GameObject root = instance.Root;
                    builder.TearDown();
                    Assert.That(root.activeSelf, Is.False);
                    yield return null;
                    Assert.That(root == null, Is.True);
                    Assert.That(host.transform.childCount, Is.Zero);
                }
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator WaterTransferCommitsAtomicallyAndCancellationPreservesOldState()
        {
            var host = new GameObject("DungeonV2AtomicWaterAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-golden");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonEnvironmentRuntimeV2 environment = builder.CurrentInstance.Environment;

                Assert.That(environment.TryBeginTransition(
                    IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                    "unlock-water-routing"), Is.True);
                Assert.That(environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.ValveUnlockControllerId), Is.EqualTo("Unlocked"));

                const string initial = IndustrialFactoryV2Ruleset.FreightSumpFilled;
                const string target = IndustrialFactoryV2Ruleset.StoredInReservoir;
                string transitionId = "water-transfer-" + initial + "-to-" + target;
                Assert.That(environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId), Is.EqualTo(initial));
                Assert.That(environment.GetFluidConfiguration(
                    IndustrialFactoryV2Ruleset.WaterNetworkId), Is.EqualTo(initial));
                AssertActiveFluidConfiguration(builder.CurrentInstance, initial);

                Assert.That(environment.TryBeginTransition(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    transitionId), Is.True);
                yield return new WaitForSecondsRealtime(2.35f);

                Assert.That(environment.IsTransitionInProgress, Is.True);
                Assert.That(environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId), Is.EqualTo(initial));
                Assert.That(environment.GetFluidConfiguration(
                    IndustrialFactoryV2Ruleset.WaterNetworkId), Is.EqualTo(initial));
                AssertActiveFluidConfiguration(builder.CurrentInstance, initial);

                Assert.That(environment.CancelPendingTransition(), Is.True);
                yield return new WaitForSecondsRealtime(0.2f);
                Assert.That(environment.IsTransitionInProgress, Is.False);
                Assert.That(environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId), Is.EqualTo(initial));
                Assert.That(environment.GetFluidConfiguration(
                    IndustrialFactoryV2Ruleset.WaterNetworkId), Is.EqualTo(initial));
                AssertActiveFluidConfiguration(builder.CurrentInstance, initial);

                Assert.That(environment.TryBeginTransition(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    transitionId), Is.True);
                float timeout = Time.realtimeSinceStartup + 3.5f;
                while (environment.IsTransitionInProgress && Time.realtimeSinceStartup < timeout)
                {
                    yield return null;
                }

                Assert.That(environment.IsTransitionInProgress, Is.False, "Water transfer timed out.");
                Assert.That(environment.GetControllerState(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId), Is.EqualTo(target));
                Assert.That(environment.GetFluidConfiguration(
                    IndustrialFactoryV2Ruleset.WaterNetworkId), Is.EqualTo(target));
                AssertActiveFluidConfiguration(builder.CurrentInstance, target);
                Assert.That(environment.CancelPendingTransition(), Is.False,
                    "Cancelling immediately after commit must not roll back the committed state.");
                Assert.That(environment.GetFluidConfiguration(
                    IndustrialFactoryV2Ruleset.WaterNetworkId), Is.EqualTo(target));
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator WaterConsoleOwnsNamedPlayerLockUntilCommitOrCancellation()
        {
            var host = new GameObject("DungeonV2WaterConsoleCommitmentAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            GameObject playerObject = null;
            GameObject persistentPlayerObject = null;
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-console-commitment");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);

                DungeonEnvironmentConsoleRuntimeV2[] consoles = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true);
                DungeonEnvironmentConsoleRuntimeV2 valve = consoles.Single(value =>
                    value.ControllerId == IndustrialFactoryV2Ruleset.ValveUnlockControllerId);
                DungeonEnvironmentConsoleRuntimeV2 routing = consoles.Single(value =>
                    value.ControllerId == IndustrialFactoryV2Ruleset.WaterRoutingControllerId);

                // A camp/legacy player may survive into a broad Play Mode
                // suite. Create that decoy first so FindAny-style lookup would
                // choose the wrong actor, then place the interacting player at
                // the actual routing console.
                persistentPlayerObject = new GameObject("DungeonV2PersistentPlayerDecoy");
                persistentPlayerObject.AddComponent<CharacterController>();
                ProductionPlayerController persistentPlayer =
                    persistentPlayerObject.AddComponent<ProductionPlayerController>();
                persistentPlayerObject.transform.position = routing.transform.position + Vector3.right * 40f;

                playerObject = new GameObject("DungeonV2CommittedPlayer");
                playerObject.AddComponent<CharacterController>();
                ProductionPlayerController playerController =
                    playerObject.AddComponent<ProductionPlayerController>();
                playerObject.transform.position = routing.transform.position;

                Assert.That(valve.TryActivateNextTransition(), Is.True);
                playerController.SetGameplayLock("test-independent-lock", true);
                Assert.That(routing.TryActivateNextTransition(), Is.True);
                playerController.SetGameplayLock("test-independent-lock", false);
                Assert.That(playerController.GameplayEnabled, Is.False,
                    "Removing another named lock must leave the console's transfer lock in force.");
                Assert.That(persistentPlayer.GameplayEnabled, Is.True,
                    "Only the nearest active player interacting at this console may be locked.");

                Assert.That(builder.CurrentInstance.Environment.CancelPendingTransition(), Is.True);
                yield return null;
                Assert.That(playerController.GameplayEnabled, Is.True,
                    "Cancelling before commit must restore player control and retain the old water state.");

                Assert.That(routing.TryActivateNextTransition(), Is.True);
                float timeout = Time.realtimeSinceStartup + 3.5f;
                while (builder.CurrentInstance.Environment.IsTransitionInProgress
                       && Time.realtimeSinceStartup < timeout)
                {
                    yield return null;
                }

                Assert.That(builder.CurrentInstance.Environment.IsTransitionInProgress, Is.False);
                Assert.That(playerController.GameplayEnabled, Is.True,
                    "An atomic transfer commit must release only its own gameplay lock.");
            }
            finally
            {
                if (playerObject != null) UnityEngine.Object.Destroy(playerObject);
                if (persistentPlayerObject != null) UnityEngine.Object.Destroy(persistentPlayerObject);
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator WaterConsoleCyclesCriticalReservoirBeforeOptionalGantryAndSupportsExplicitSelection()
        {
            var host = new GameObject("DungeonV2WaterConsoleRoutingAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-console-routing");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonEnvironmentRuntimeV2 environment = builder.CurrentInstance.Environment;
                DungeonEnvironmentConsoleRuntimeV2 routing = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                    .Single(value => value.ControllerId == IndustrialFactoryV2Ruleset.WaterRoutingControllerId);

                RestoreWaterRoutingState(environment, plan, IndustrialFactoryV2Ruleset.FreightSumpFilled);
                Assert.That(routing.TryActivateNextTransition(), Is.True);
                Assert.That(environment.PendingTransitionId, Is.EqualTo(
                    "water-transfer-FreightSumpFilled-to-StoredInReservoir"),
                    "The first deliberate transfer must open the critical-path dry Freight service tunnel.");
                Assert.That(environment.CancelPendingTransition(), Is.True);

                RestoreWaterRoutingState(environment, plan, IndustrialFactoryV2Ruleset.StoredInReservoir);
                Assert.That(routing.TryActivateNextTransition(), Is.True);
                Assert.That(environment.PendingTransitionId, Is.EqualTo(
                    "water-transfer-StoredInReservoir-to-GantrySumpFilled"));
                Assert.That(environment.CancelPendingTransition(), Is.True);

                RestoreWaterRoutingState(environment, plan, IndustrialFactoryV2Ruleset.GantrySumpFilled);
                Assert.That(routing.TryActivateNextTransition(), Is.True);
                Assert.That(environment.PendingTransitionId, Is.EqualTo(
                    "water-transfer-GantrySumpFilled-to-FreightSumpFilled"));
                Assert.That(environment.CancelPendingTransition(), Is.True);

                RestoreWaterRoutingState(environment, plan, IndustrialFactoryV2Ruleset.FreightSumpFilled);
                Assert.That(routing.TryActivateTransitionToState(IndustrialFactoryV2Ruleset.GantrySumpFilled), Is.True,
                    "A UI presenter must be able to select any valid stable configuration explicitly.");
                Assert.That(environment.PendingTransitionId, Is.EqualTo(
                    "water-transfer-FreightSumpFilled-to-GantrySumpFilled"));
                Assert.That(environment.CancelPendingTransition(), Is.True);
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator AuthoredMovingPlatformExistsMovesAndResetsAfterTeardown()
        {
            var host = new GameObject("DungeonV2MovingPlatformAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-moving-platform-runtime");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);

                DungeonMovingPlatformRuntimeV2 platform = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonMovingPlatformRuntimeV2>(true)
                    .Single();
                Rigidbody body = platform.GetComponent<Rigidbody>();
                DungeonMovingPlatformRiderRelayV2 relay = platform
                    .GetComponentInChildren<DungeonMovingPlatformRiderRelayV2>(true);
                BoxCollider riderTrigger = relay != null ? relay.GetComponent<BoxCollider>() : null;
                Vector3 authoredOrigin = platform.transform.position;

                Assert.That(plan.Surfaces.Count(surface =>
                    surface.Id == IndustrialFactoryV2Ruleset.ReservoirMovingPlatformSurfaceId),
                    Is.EqualTo(1));
                Assert.That(platform.CurrentOffset, Is.EqualTo(0f).Within(0.00001f));
                Assert.That(body, Is.Not.Null);
                Assert.That(body.isKinematic, Is.True);
                Assert.That(body.useGravity, Is.False);
                Assert.That(relay, Is.Not.Null);
                Assert.That(riderTrigger, Is.Not.Null);
                Assert.That(riderTrigger.isTrigger, Is.True);

                yield return new WaitForFixedUpdate();
                yield return new WaitForFixedUpdate();

                Assert.That(Mathf.Abs(platform.CurrentOffset), Is.GreaterThan(0.01f));
                Assert.That(Vector3.Distance(body.position, authoredOrigin), Is.GreaterThan(0.01f));

                GameObject firstRoot = builder.CurrentInstance.Root;
                DungeonMovingPlatformRuntimeV2 firstPlatform = platform;
                builder.TearDown();
                Assert.That(firstRoot.activeSelf, Is.False);
                yield return null;
                Assert.That(firstRoot == null, Is.True);
                Assert.That(firstPlatform == null, Is.True);

                Assert.That(builder.TryBuild(plan, null, null, out error), Is.True, error);
                DungeonMovingPlatformRuntimeV2 resetPlatform = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonMovingPlatformRuntimeV2>(true)
                    .Single();
                Assert.That(resetPlatform.CurrentOffset, Is.EqualTo(0f).Within(0.00001f),
                    "Moving-platform phase is expedition-local and must restart at zero.");
                Assert.That(Vector3.Distance(resetPlatform.transform.position, authoredOrigin),
                    Is.LessThan(0.0001f));
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator CredentialCrumbleCommitsIntactToCollapsedAtomically()
        {
            var host = new GameObject("DungeonV2CrumbleAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            GameObject playerObject = null;
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-crumble-runtime");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonEnvironmentRuntimeV2 environment = builder.CurrentInstance.Environment;
                DungeonCrumbleSurfaceRuntimeV2 crumble = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonCrumbleSurfaceRuntimeV2>(true)
                    .Single();
                DungeonCrumbleSurfaceRelayV2 relay = crumble
                    .GetComponentInChildren<DungeonCrumbleSurfaceRelayV2>(true);
                MeshCollider structuralCollider = crumble.GetComponent<MeshCollider>();

                Assert.That(crumble.ControllerId,
                    Is.EqualTo(IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId));
                Assert.That(environment.GetControllerState(crumble.ControllerId), Is.EqualTo("Intact"));
                Assert.That(crumble.gameObject.activeSelf, Is.True);
                Assert.That(structuralCollider, Is.Not.Null);
                Assert.That(structuralCollider.enabled, Is.True);
                Assert.That(relay, Is.Not.Null);

                playerObject = new GameObject("DungeonV2CrumblePlayer");
                CharacterController playerCollider = playerObject.AddComponent<CharacterController>();
                playerObject.AddComponent<ProductionPlayerController>();
                relay.gameObject.SendMessage(
                    "OnTriggerEnter",
                    playerCollider,
                    SendMessageOptions.RequireReceiver);

                Assert.That(crumble.IsArmed, Is.True);
                Assert.That(environment.IsTransitionInProgress, Is.True);
                Assert.That(environment.GetControllerState(crumble.ControllerId), Is.EqualTo("Intact"));
                Assert.That(crumble.gameObject.activeSelf, Is.True,
                    "The certified platform must remain authoritative throughout its warning window.");

                yield return new WaitForSecondsRealtime(0.25f);
                Assert.That(environment.IsTransitionInProgress, Is.True);
                Assert.That(environment.GetControllerState(crumble.ControllerId), Is.EqualTo("Intact"));
                Assert.That(crumble.gameObject.activeSelf, Is.True);

                float timeout = Time.realtimeSinceStartup + 1.5f;
                while (environment.IsTransitionInProgress && Time.realtimeSinceStartup < timeout)
                {
                    yield return null;
                }

                Assert.That(environment.IsTransitionInProgress, Is.False, "Crumble commit timed out.");
                Assert.That(environment.GetControllerState(crumble.ControllerId), Is.EqualTo("Collapsed"));
                Assert.That(crumble.gameObject.activeSelf, Is.False,
                    "Collision and geometry must disappear in the same committed predicate update.");
                Assert.That(environment.TryBeginTransition(
                    crumble.ControllerId,
                    "collapse-credential-tower-platform"), Is.False,
                    "A committed collapse cannot be armed twice.");
            }
            finally
            {
                if (playerObject != null) UnityEngine.Object.Destroy(playerObject);
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator MinimapIsLayeredAndKeySeekerRevealsOnlyAuthorizedRequiredRoute()
        {
            var host = new GameObject("DungeonV2MinimapAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-golden");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonLayeredMinimapComponentV2 minimap = builder.CurrentInstance.Minimap;
                DungeonLayeredMinimapViewStateV2 initial = minimap.ViewState;

                Assert.That(initial.SelectedStratum, Is.EqualTo(DungeonElevationStratumV2.Entry));
                Assert.That(initial.Regions, Has.Count.LessThan(plan.Regions.Count));
                Assert.That(initial.Regions.All(region => region.Stratum == initial.SelectedStratum), Is.True);
                Assert.That(initial.RegionKnowledge.Count(region =>
                    region.Level == DungeonMapKnowledgeLevelV2.Hidden), Is.GreaterThan(0));
                Assert.That(initial.Connections, Is.Empty);

                DungeonKeySeekerRuntimeV2 seeker = builder.CurrentInstance.Root
                    .GetComponentInChildren<DungeonKeySeekerRuntimeV2>(true);
                Assert.That(seeker, Is.Not.Null);
                Assert.That(seeker.Activate(), Is.True);

                Assert.That(seeker.LastRevealedEdgeIds, Is.EqualTo(new[]
                {
                    "edge-factory-0-1",
                    "edge-factory-1-2",
                    "edge-factory-to-freight-sump",
                    "edge-freight-sump-return"
                }), "The Key Seeker must route around the closed water bulkhead to its required controller.");

                DungeonMapKnowledgeStateV2 afterSeeker = minimap.CaptureKnowledge();
                Assert.That(afterSeeker.DiscoveredTraversalEdgeIds,
                    Is.EquivalentTo(seeker.LastRevealedEdgeIds));
                Assert.That(afterSeeker.DiscoveredLandmarkIds, Is.Empty,
                    "Key Seeker must not expose optional landmarks or treasure.");

                minimap.VisitRegion("water-freight-sump");
                DungeonLayeredMinimapViewStateV2 lower = minimap.ViewState;
                Assert.That(lower.SelectedStratum, Is.EqualTo(DungeonElevationStratumV2.Lower));
                Assert.That(lower.Regions, Is.Not.Empty);
                Assert.That(lower.Regions.All(region => region.Stratum == DungeonElevationStratumV2.Lower),
                    Is.True);
                Assert.That(lower.Regions.Any(region => region.Id == "water-freight-sump"), Is.True);
                Assert.That(lower.Regions.Any(region => region.Id == "water-reservoir-service"), Is.True,
                    "Entering a cross-room water tunnel should reveal it as one continuous feature.");
                Assert.That(lower.Regions.Any(region => region.Stratum != DungeonElevationStratumV2.Lower),
                    Is.False, "Stacked strata must not collapse into one flat view.");
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator FallbackRecoveryReturnsPlayerToLastSafeAnchorAndLogsDiagnostic()
        {
            var host = new GameObject("DungeonV2FallbackAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            GameObject playerObject = null;
            GameObject safeAnchor = null;
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-golden");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonFallbackRecoveryV2 fallback = builder.CurrentInstance.Fallback;
                Assert.That(fallback, Is.Not.Null);

                safeAnchor = new GameObject("V2FallbackTestSafeAnchor");
                safeAnchor.transform.position = new Vector3(8f, 3f, -4f);
                safeAnchor.transform.rotation = Quaternion.Euler(0f, 65f, 0f);
                fallback.SetLastSafeAnchor(safeAnchor.transform);

                playerObject = new GameObject("V2FallbackTestPlayer");
                CharacterController controller = playerObject.AddComponent<CharacterController>();
                playerObject.AddComponent<ProductionPlayerController>();
                playerObject.transform.position = fallback.transform.position;

                LogAssert.Expect(LogType.Error, new Regex(
                    "Player reached the technical fallback plane.*recovering without penalty",
                    RegexOptions.Singleline));
                fallback.gameObject.SendMessage("OnTriggerEnter", controller, SendMessageOptions.RequireReceiver);

                Assert.That(fallback.DiagnosticRecoveryCount, Is.EqualTo(1));
                Assert.That(Vector3.Distance(
                    playerObject.transform.position,
                    safeAnchor.transform.position), Is.LessThan(0.0001f));
                Assert.That(Quaternion.Angle(playerObject.transform.rotation, safeAnchor.transform.rotation),
                    Is.LessThan(0.01f));
            }
            finally
            {
                if (playerObject != null) UnityEngine.Object.Destroy(playerObject);
                if (safeAnchor != null) UnityEngine.Object.Destroy(safeAnchor);
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LocalNavigationUsesPlanRegionIdsAndReleasesBakedDataOnTeardown()
        {
            var host = new GameObject("DungeonV2LocalNavigationAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            builder.ConfigureLocalNavigation(createNavigation: true, bakeImmediately: false);
            DungeonLocalNavigationRuntimeV2 firstNavigation = null;
            GameObject root = null;
            try
            {
                DungeonPlanV2 plan = GeneratePlan(DungeonBiomeDistrictKindV2.MagmaUndercroft);
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                root = builder.GeneratedRoot;
                IReadOnlyList<DungeonLocalNavigationRuntimeV2> navigation =
                    builder.CurrentInstance.LocalNavigation;

                Assert.That(navigation, Has.Count.EqualTo(plan.Regions
                    .Select(value => value.LocalNavigationRegionId)
                    .Distinct(StringComparer.Ordinal)
                    .Count()));
                Assert.That(navigation.Select(value => value.LocalNavigationRegionId),
                    Is.EquivalentTo(plan.Regions
                        .Select(value => value.LocalNavigationRegionId)
                        .Distinct(StringComparer.Ordinal)));
                Assert.That(navigation.SelectMany(value => value.RegionIds),
                    Is.EquivalentTo(plan.Regions.Select(value => value.Id)));
                Assert.That(navigation.All(value => value.Surface != null), Is.True);
                int worldLayer = LayerMask.NameToLayer("WorldGeometry");
                Assert.That(worldLayer, Is.GreaterThanOrEqualTo(0));
                Assert.That(navigation.All(value => value.Surface.layerMask == (1 << worldLayer)), Is.True);
                Assert.That(root.GetComponentsInChildren<MeshCollider>(true)
                    .All(value => value.gameObject.layer == worldLayer), Is.True,
                    "Only certified WorldGeometry colliders may feed local NavMesh baking.");

                firstNavigation = navigation[0];
                firstNavigation.Rebuild();
                Assert.That(firstNavigation.HasBakedData, Is.True,
                    "A production local navigation region must own removable NavMeshData.");

                builder.TearDown();
                Assert.That(root.activeSelf, Is.False);
                Assert.That(firstNavigation.HasBakedData, Is.False,
                    "Teardown must remove NavMeshData immediately, before deferred GameObject destruction.");
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
            Assert.That(root == null, Is.True);
        }

        [UnityTest]
        public IEnumerator BakedLocalNavigationTracksEnvironmentCommitsWhileOptOutRemainsStatic()
        {
            var host = new GameObject("DungeonV2NavigationEnvironmentAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            DungeonPlanV2 plan = GeneratePlan(DungeonBiomeDistrictKindV2.ElectricalUndercroft);
            try
            {
                builder.ConfigureLocalNavigation(createNavigation: true, bakeImmediately: true);
                Assert.That(builder.TryBuild(plan, null, null, out string bakedError), Is.True, bakedError);
                DungeonLocalNavigationRuntimeV2 bakedNavigation =
                    builder.CurrentInstance.LocalNavigation[0];
                UnityEngine.Object bakedBefore = bakedNavigation.Surface.navMeshData;
                Assert.That(bakedBefore, Is.Not.Null);
                DungeonEnvironmentConsoleRuntimeV2 bakedConsole = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                    .Single(value => value.ControllerId == IndustrialFactoryV2Ruleset.HazardControllerId);

                Assert.That(bakedConsole.TryActivateNextTransition(), Is.True);
                Assert.That(bakedNavigation.HasBakedData, Is.True);
                Assert.That(bakedNavigation.Surface.navMeshData, Is.Not.SameAs(bakedBefore),
                    "A committed predicate change must rebuild opted-in local navigation after colliders update.");

                builder.TearDown();
                yield return null;

                builder.ConfigureLocalNavigation(createNavigation: true, bakeImmediately: false);
                Assert.That(builder.TryBuild(plan, null, null, out string staticError), Is.True, staticError);
                DungeonLocalNavigationRuntimeV2 staticNavigation =
                    builder.CurrentInstance.LocalNavigation[0];
                staticNavigation.Rebuild();
                UnityEngine.Object staticBefore = staticNavigation.Surface.navMeshData;
                Assert.That(staticBefore, Is.Not.Null);
                DungeonEnvironmentConsoleRuntimeV2 staticConsole = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                    .Single(value => value.ControllerId == IndustrialFactoryV2Ruleset.HazardControllerId);

                Assert.That(staticConsole.TryActivateNextTransition(), Is.True);
                Assert.That(staticNavigation.Surface.navMeshData, Is.SameAs(staticBefore),
                    "Navigation configured not to bake must not opt in merely because a caller rebuilt it manually.");
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator ElectricalGroundingConsoleCommitsOnceAndReplaysIdempotently()
        {
            var host = new GameObject("DungeonV2ElectricalGroundingAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = GeneratePlan(DungeonBiomeDistrictKindV2.ElectricalUndercroft);
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonEnvironmentRuntimeV2 environment = builder.CurrentInstance.Environment;
                DungeonEnvironmentConsoleRuntimeV2 console = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonEnvironmentConsoleRuntimeV2>(true)
                    .Single(value => value.ControllerId == IndustrialFactoryV2Ruleset.HazardControllerId);
                DungeonHazardDistrictRuntimeV2 district = builder.GeneratedRoot
                    .GetComponentsInChildren<DungeonHazardDistrictRuntimeV2>(true)
                    .Single(value => value.Kind == DungeonHazardSurfaceKindV2.Electric);
                district.SetAutomaticSimulation(false);
                int committedChanges = 0;
                environment.CommittedStateChanged += _ => committedChanges += 1;

                Assert.That(environment.GetControllerState(IndustrialFactoryV2Ruleset.HazardControllerId),
                    Is.EqualTo("Cycling"));
                Assert.That(console.TryActivateNextTransition(), Is.True);
                Assert.That(console.LastActivationWasIdempotentReplay, Is.False);
                Assert.That(environment.GetControllerState(IndustrialFactoryV2Ruleset.HazardControllerId),
                    Is.EqualTo("Grounded"));
                Assert.That(district.VisualPhase, Is.EqualTo(DungeonHazardVisualPhaseV2.ElectricGrounded));
                Assert.That(committedChanges, Is.EqualTo(1));

                Assert.That(console.TryActivateNextTransition(), Is.True,
                    "Operating an already-grounded section is a successful idempotent replay.");
                Assert.That(console.LastActivationWasIdempotentReplay, Is.True);
                Assert.That(environment.GetControllerState(IndustrialFactoryV2Ruleset.HazardControllerId),
                    Is.EqualTo("Grounded"));
                Assert.That(committedChanges, Is.EqualTo(1),
                    "An idempotent replay must not emit a second authoritative commit.");
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LayeredMapMarkersStayPositionedAndBasinsTrackCommittedWaterState()
        {
            var host = new GameObject("DungeonV2LayeredMapTopologyAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                    "industrial-factory-v2-layered-map-state");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonSceneInstanceV2 instance = builder.CurrentInstance;
                DungeonLayeredMinimapComponentV2 minimap = instance.Minimap;

                const string SortingRegionId = "factory-sorting-gantry";
                minimap.VisitRegion(SortingRegionId);
                foreach (DungeonAnchorPlanV2 console in plan.Anchors.Where(value =>
                             value.RegionId == SortingRegionId
                             && value.Kind == DungeonAnchorKindV2.Console))
                {
                    minimap.SurveyAnchor(console.Id);
                }

                DungeonLayeredMapMarkerV2[] controllerMarkersBefore = minimap.ViewState.Markers
                    .Where(value => value.Kind == DungeonLayeredMapMarkerKindV2.Console
                        || value.Kind == DungeonLayeredMapMarkerKindV2.Valve)
                    .ToArray();
                Assert.That(controllerMarkersBefore, Has.Length.EqualTo(2));

                foreach (DungeonRegionPlanV2 waterRegion in plan.Regions.Where(value =>
                             value.BiomeDistrictId == IndustrialFactoryV2Ruleset.WaterworksDistrictId))
                {
                    minimap.SeeRegion(waterRegion.Id);
                }
                minimap.VisitRegion("water-freight-sump");
                DungeonLayeredMinimapViewStateV2 lowerBefore = minimap.ViewState;
                Assert.That(lowerBefore.SelectedStratum, Is.EqualTo(DungeonElevationStratumV2.Lower));
                Assert.That(lowerBefore.Basins, Has.Count.EqualTo(3));
                Assert.That(lowerBefore.Basins.Count(value => value.IsFilled), Is.EqualTo(1));
                Assert.That(lowerBefore.Basins.Single(value => value.IsFilled).RegionId,
                    Is.EqualTo("water-freight-sump"));
                var basinGeometry = lowerBefore.Basins.ToDictionary(
                    value => value.Id,
                    value => (value.Center, value.Size),
                    StringComparer.Ordinal);

                DungeonEnvironmentRuntimeV2 environment = instance.Environment;
                Assert.That(environment.TryBeginTransition(
                    IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                    "unlock-water-routing"), Is.True);
                Assert.That(environment.TryBeginTransition(
                    IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                    "water-transfer-FreightSumpFilled-to-StoredInReservoir"), Is.True);
                yield return new WaitForSecondsRealtime(2.6f);

                DungeonLayeredMinimapViewStateV2 lowerAfter = minimap.ViewState;
                Assert.That(lowerAfter.Basins.Count(value => value.IsFilled), Is.EqualTo(1));
                Assert.That(lowerAfter.Basins.Single(value => value.IsFilled).RegionId,
                    Is.EqualTo("water-reservoir-service"));
                Assert.That(lowerAfter.Basins.Select(value => value.Id),
                    Is.EquivalentTo(lowerBefore.Basins.Select(value => value.Id)));
                foreach (DungeonLayeredMapBasinV2 basin in lowerAfter.Basins)
                {
                    Assert.That((basin.Center, basin.Size), Is.EqualTo(basinGeometry[basin.Id]), basin.Id);
                }

                minimap.CycleLayer(1);
                DungeonLayeredMapMarkerV2[] controllerMarkersAfter = minimap.ViewState.Markers
                    .Where(value => value.Kind == DungeonLayeredMapMarkerKindV2.Console
                        || value.Kind == DungeonLayeredMapMarkerKindV2.Valve)
                    .ToArray();
                Assert.That(controllerMarkersAfter.Select(value => value.Id),
                    Is.EquivalentTo(controllerMarkersBefore.Select(value => value.Id)));
                foreach (DungeonLayeredMapMarkerV2 marker in controllerMarkersAfter)
                {
                    DungeonLayeredMapMarkerV2 before = controllerMarkersBefore.Single(value => value.Id == marker.Id);
                    Assert.That(marker.Position, Is.EqualTo(before.Position), marker.Id);
                }
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LayeredMapGateAndShortcutMarkersKeepPositionWhileStateChanges()
        {
            var host = new GameObject("DungeonV2LayeredMapMarkerStateAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                    "industrial-factory-v2-layered-map-marker-state");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonSceneInstanceV2 instance = builder.CurrentInstance;
                DungeonLayeredMinimapComponentV2 minimap = instance.Minimap;
                DungeonEnvironmentRuntimeV2 environment = instance.Environment;

                DungeonTraversalEdgePlanV2 gate = plan.TraversalEdges.Single(value =>
                    value.Id == IndustrialFactoryV2Ruleset.CredentialGateEdgeId);
                Assert.That(gate.IsProtectedProgressionBoundary, Is.True);
                minimap.VisitRegion(gate.FromRegionId);
                minimap.SeeRegion(gate.ToRegionId);
                minimap.RevealConnection(gate.Id);
                DungeonLayeredMapMarkerV2 lockedGate = minimap.ViewState.Markers.Single(value =>
                    value.ProfileId == gate.Id);
                Assert.That(lockedGate.StateId, Is.EqualTo("Locked"));

                Assert.That(environment.AddRequiredItem(
                    IndustrialFactoryV2Ruleset.CredentialKeyRewardId), Is.True);
                DungeonLayeredMapMarkerV2 openGate = minimap.ViewState.Markers.Single(value =>
                    value.ProfileId == gate.Id);
                Assert.That(openGate.Id, Is.EqualTo(lockedGate.Id));
                Assert.That(openGate.Position, Is.EqualTo(lockedGate.Position));
                Assert.That(openGate.StateId, Is.EqualTo("Open"));

                DungeonShortcutPlanV2 shortcut = plan.Shortcuts.Single();
                DungeonAnchorPlanV2 shortcutAnchor = plan.Anchors.Single(value =>
                    value.Kind == DungeonAnchorKindV2.ShortcutActivation
                    && value.ProfileId == shortcut.Id);
                minimap.VisitRegion(shortcutAnchor.RegionId);
                minimap.RevealShortcut(shortcut.Id);
                DungeonLayeredMapMarkerV2 inactiveShortcut = minimap.ViewState.Markers.Single(value =>
                    value.Kind == DungeonLayeredMapMarkerKindV2.Shortcut
                    && value.ProfileId == shortcut.Id);
                Assert.That(inactiveShortcut.StateId, Is.EqualTo("Inactive"));

                Assert.That(environment.ActivateShortcut(shortcut.Id), Is.True);
                DungeonLayeredMapMarkerV2 activeShortcut = minimap.ViewState.Markers.Single(value =>
                    value.Kind == DungeonLayeredMapMarkerKindV2.Shortcut
                    && value.ProfileId == shortcut.Id);
                Assert.That(activeShortcut.Id, Is.EqualTo(inactiveShortcut.Id));
                Assert.That(activeShortcut.Position, Is.EqualTo(inactiveShortcut.Position));
                Assert.That(activeShortcut.StateId, Is.EqualTo("Active"));
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LayeredMapMarksRegionExploredWhenFinalConnectorIsRevealed()
        {
            var host = new GameObject("DungeonV2LayeredMapExplorationAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                    "industrial-factory-v2-layered-map-exploration");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonLayeredMinimapComponentV2 minimap = builder.CurrentInstance.Minimap;
                DungeonRegionPlanV2 region = plan.Regions.First(value =>
                    plan.TraversalEdges.Any(edge => edge.FromRegionId == value.Id
                        || edge.ToRegionId == value.Id));
                minimap.VisitRegion(region.Id);
                foreach (string landmarkId in region.LandmarkAnchorIds)
                {
                    minimap.SurveyAnchor(landmarkId);
                }

                DungeonTraversalEdgePlanV2[] pending = plan.TraversalEdges
                    .Where(edge => (edge.FromRegionId == region.Id || edge.ToRegionId == region.Id)
                        && !minimap.CaptureKnowledge().DiscoveredTraversalEdgeIds.Contains(edge.Id))
                    .ToArray();
                Assert.That(pending, Is.Not.Empty);
                foreach (DungeonTraversalEdgePlanV2 edge in pending.Take(pending.Length - 1))
                {
                    minimap.RevealConnection(edge.Id);
                }

                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Visited));
                minimap.RevealConnection(pending[pending.Length - 1].Id);
                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Explored));
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LayeredMapRequiresEveryConsoleBeforeRegionBecomesExplored()
        {
            var host = new GameObject("DungeonV2LayeredMapConsoleExplorationAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                    "industrial-factory-v2-layered-map-console-exploration");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonLayeredMinimapComponentV2 minimap = builder.CurrentInstance.Minimap;
                DungeonRegionPlanV2 region = plan.Regions.First(value => value.ConsoleAnchorIds.Count > 1);
                minimap.VisitRegion(region.Id);
                foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges.Where(value =>
                    value.FromRegionId == region.Id || value.ToRegionId == region.Id))
                {
                    minimap.RevealConnection(edge.Id);
                }

                foreach (string landmarkId in region.LandmarkAnchorIds)
                {
                    minimap.SurveyAnchor(landmarkId);
                }

                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Visited),
                    "Known connectors and landmarks must not hide unsurveyed console mechanisms.");
                foreach (string consoleAnchorId in region.ConsoleAnchorIds.Take(region.ConsoleAnchorIds.Count - 1))
                {
                    minimap.SurveyAnchor(consoleAnchorId);
                }

                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Visited));
                minimap.SurveyAnchor(region.ConsoleAnchorIds[region.ConsoleAnchorIds.Count - 1]);
                DungeonMapKnowledgeStateV2 knowledge = minimap.CaptureKnowledge();
                Assert.That(knowledge.Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Explored));
                Assert.That(knowledge.KnownControllerIds,
                    Is.EquivalentTo(region.ConsoleAnchorIds
                        .Select(anchorId => plan.Anchors.Single(anchor => anchor.Id == anchorId).ProfileId)),
                    "The knowledge ledger must contain controller IDs rather than presentation anchor IDs.");
                Assert.That(knowledge.KnownControllerIds.Intersect(region.ConsoleAnchorIds), Is.Empty);
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator LayeredMapRevealShortcutReevaluatesItsActivationRegion()
        {
            var host = new GameObject("DungeonV2LayeredMapShortcutExplorationAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate(
                    "industrial-factory-v2-layered-map-shortcut-exploration");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                DungeonLayeredMinimapComponentV2 minimap = builder.CurrentInstance.Minimap;
                DungeonShortcutPlanV2 shortcut = plan.Shortcuts.Single();
                DungeonRegionPlanV2 region = plan.Regions.Single(value =>
                    value.Id == shortcut.ActivationRegionId);
                minimap.VisitRegion(region.Id);
                foreach (DungeonTraversalEdgePlanV2 edge in plan.TraversalEdges.Where(value =>
                    value.FromRegionId == region.Id || value.ToRegionId == region.Id))
                {
                    minimap.RevealConnection(edge.Id);
                }

                foreach (string landmarkId in region.LandmarkAnchorIds)
                {
                    minimap.SurveyAnchor(landmarkId);
                }

                foreach (string consoleAnchorId in region.ConsoleAnchorIds)
                {
                    minimap.SurveyAnchor(consoleAnchorId);
                }

                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Visited),
                    "The activation-side shortcut is a registered map reveal and must block explored state.");
                minimap.RevealShortcut(shortcut.Id);
                Assert.That(minimap.CaptureKnowledge().Regions.Single(value => value.RegionId == region.Id).Level,
                    Is.EqualTo(DungeonMapKnowledgeLevelV2.Explored),
                    "RevealShortcut must immediately reevaluate the activation region.");
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        [UnityTest]
        public IEnumerator RepeatedBuildAndTeardownRetainsNoOwnedRootsMeshesOrMaterials()
        {
            var host = new GameObject("DungeonV2RepeatedTeardownAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            var generator = new IndustrialFactoryV2Generator();
            try
            {
                for (int cycle = 0; cycle < 4; cycle += 1)
                {
                    DungeonPlanV2 plan = generator.Generate("industrial-factory-v2-runtime-cycle-" + cycle);
                    Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
                    GameObject root = builder.GeneratedRoot;
                    Mesh[] ownedMeshes = root.GetComponentsInChildren<MeshFilter>(true)
                        .Select(filter => filter.sharedMesh)
                        .Where(mesh => mesh != null && mesh.name.EndsWith("_Mesh", StringComparison.Ordinal))
                        .Distinct()
                        .ToArray();
                    Material[] ownedMaterials = root.GetComponentsInChildren<Renderer>(true)
                        .Select(renderer => renderer.sharedMaterial)
                        .Where(material => material != null
                            && material.name.StartsWith("V2_", StringComparison.Ordinal))
                        .Distinct()
                        .ToArray();

                    Assert.That(ownedMeshes, Is.Not.Empty);
                    Assert.That(ownedMaterials, Is.Not.Empty);
                    builder.TearDown();
                    Assert.That(root.activeSelf, Is.False);
                    yield return null;

                    Assert.That(root == null, Is.True, "Generated root survived cycle " + cycle + ".");
                    Assert.That(ownedMeshes.All(mesh => mesh == null), Is.True,
                        "An owned mesh survived cycle " + cycle + ".");
                    Assert.That(ownedMaterials.All(material => material == null), Is.True,
                        "An owned material survived cycle " + cycle + ".");
                    Assert.That(host.transform.childCount, Is.Zero);
                    Assert.That(builder.CurrentInstance, Is.Null);
                }
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.Destroy(host);
            }

            yield return null;
        }

        private static readonly DungeonBiomeDistrictKindV2[] HazardKinds =
        {
            DungeonBiomeDistrictKindV2.MagmaUndercroft,
            DungeonBiomeDistrictKindV2.ElectricalUndercroft
        };

        private static DungeonPlanV2 GeneratePlan(DungeonBiomeDistrictKindV2 hazardKind)
        {
            var generator = new IndustrialFactoryV2Generator();
            for (int index = 0; index < 64; index += 1)
            {
                DungeonPlanV2 plan = generator.Generate("industrial-factory-v2-runtime-hazard-" + index);
                if (plan.Districts.Any(district => district.Kind == hazardKind)) return plan;
            }

            Assert.Fail("Unable to locate deterministic golden seed for " + hazardKind + ".");
            return null;
        }

        private static void RestoreWaterRoutingState(
            DungeonEnvironmentRuntimeV2 environment,
            DungeonPlanV2 plan,
            string configurationId)
        {
            environment.Configure(
                plan,
                new DungeonEnvironmentSnapshotV2(
                    new[]
                    {
                        new DungeonControllerStateFactV2(
                            IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                            "Unlocked"),
                        new DungeonControllerStateFactV2(
                            IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                            configurationId)
                    },
                    new[]
                    {
                        new DungeonFluidNetworkStateV2(
                            IndustrialFactoryV2Ruleset.WaterNetworkId,
                            configurationId)
                    },
                    Array.Empty<string>()));
        }

        private static void AssertActiveFluidConfiguration(
            DungeonSceneInstanceV2 instance,
            string configurationId)
        {
            DungeonFluidNetworkPlanV2 network = instance.Plan.FluidNetworks.Single(networkPlan =>
                networkPlan.Id == IndustrialFactoryV2Ruleset.WaterNetworkId);
            var expected = new HashSet<string>(
                network.StableConfigurations.Single(configuration => configuration.Id == configurationId)
                    .ActiveFluidZoneIds,
                StringComparer.Ordinal);
            string[] actual = instance.Root.GetComponentsInChildren<PlayerTraversalMediumVolume>(true)
                .Where(volume => volume.gameObject.activeInHierarchy)
                .Select(volume => volume.StableId)
                .ToArray();
            Assert.That(actual, Is.EquivalentTo(expected));
        }
    }
}
