using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Runtime.Player;
using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonV2RuntimeAcceptanceEditModeTests
    {
        [Test]
        public void EveryStableWaterConfigurationRestoresExactlyOneCertifiedFloodedVolume()
        {
            var host = new GameObject("DungeonV2FluidRestoreEditModeAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                    .Generate("industrial-factory-v2-golden");
                DungeonFluidNetworkPlanV2 network = plan.FluidNetworks.Single();
                foreach (DungeonFluidConfigurationPlanV2 configuration in network.StableConfigurations)
                {
                    var restored = new DungeonEnvironmentSnapshotV2(
                        new[]
                        {
                            new DungeonControllerStateFactV2(
                                IndustrialFactoryV2Ruleset.WaterRoutingControllerId,
                                configuration.Id),
                            new DungeonControllerStateFactV2(
                                IndustrialFactoryV2Ruleset.ValveUnlockControllerId,
                                "Unlocked")
                        },
                        new[] { new DungeonFluidNetworkStateV2(network.Id, configuration.Id) },
                        Array.Empty<string>());

                    Assert.That(builder.TryBuild(plan, restored, null, out string error), Is.True, error);
                    PlayerTraversalMediumVolume[] volumes = builder.CurrentInstance.Root
                        .GetComponentsInChildren<PlayerTraversalMediumVolume>(true);
                    Assert.That(volumes, Has.Length.EqualTo(plan.FluidZones.Count));
                    Assert.That(volumes.All(volume =>
                        volume.Medium == PlayerTraversalMediumKind.FloodedBottomWalk), Is.True);
                    foreach (PlayerTraversalMediumVolume volume in volumes)
                    {
                        DungeonFluidZonePlanV2 zone = plan.FluidZones.Single(value => value.Id == volume.StableId);
                        Assert.That(volume.WaterDepth,
                            Is.EqualTo((float)(zone.Volume.MaximumY - zone.Volume.MinimumY)).Within(0.00001f));
                        Assert.That(volume.WaterDepth,
                            Is.GreaterThanOrEqualTo((float)zone.MinimumCushioningDepth));
                    }

                    string[] active = volumes.Where(volume => volume.gameObject.activeInHierarchy)
                        .Select(volume => volume.StableId)
                        .ToArray();
                    Assert.That(active, Is.EquivalentTo(configuration.ActiveFluidZoneIds), configuration.Id);
                    Assert.That(builder.CurrentInstance.Environment.GetFluidConfiguration(network.Id),
                        Is.EqualTo(configuration.Id));
                }
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void AuthoredTraversalMechanismsBuildFromCertifiedSurfacesAndTearDownImmediately()
        {
            var host = new GameObject("DungeonV2MechanismEditModeAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            try
            {
                DungeonPlanV2 plan = GeneratePlanWithCertifiedTraversalMechanisms();
                DungeonSurfacePlanV2[] movingSurfaces = plan.Surfaces
                    .Where(surface => surface.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                        && surface.Kind == DungeonSurfaceKindV2.MovingPlatform)
                    .OrderBy(surface => surface.Id, StringComparer.Ordinal)
                    .ToArray();
                DungeonSurfacePlanV2[] crumbleSurfaces = plan.Surfaces
                    .Where(surface => surface.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                        && surface.IsWalkable
                        && string.Equals(
                            surface.ControllerId,
                            IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                            StringComparison.Ordinal))
                    .OrderBy(surface => surface.Id, StringComparer.Ordinal)
                    .ToArray();
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);

                DungeonMovingPlatformRuntimeV2[] movingRuntimes = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonMovingPlatformRuntimeV2>(true)
                    .OrderBy(value => value.name, StringComparer.Ordinal)
                    .ToArray();
                DungeonCrumbleSurfaceRuntimeV2[] crumbleRuntimes = builder.CurrentInstance.Root
                    .GetComponentsInChildren<DungeonCrumbleSurfaceRuntimeV2>(true)
                    .OrderBy(value => value.name, StringComparer.Ordinal)
                    .ToArray();
                Assert.That(movingRuntimes, Has.Length.EqualTo(movingSurfaces.Length));
                Assert.That(crumbleRuntimes, Has.Length.EqualTo(crumbleSurfaces.Length));
                DungeonMovingPlatformRuntimeV2 moving = movingRuntimes[0];
                DungeonCrumbleSurfaceRuntimeV2 crumble = crumbleRuntimes[0];
                GameObject root = builder.CurrentInstance.Root;

                Assert.That(movingSurfaces[0].Kind, Is.EqualTo(DungeonSurfaceKindV2.MovingPlatform));
                Assert.That(moving.CurrentOffset, Is.EqualTo(0f).Within(0.00001f));
                Assert.That(moving.GetComponent<Rigidbody>(), Is.Not.Null);
                Assert.That(moving.GetComponentInChildren<DungeonMovingPlatformRiderRelayV2>(true),
                    Is.Not.Null);
                Assert.That(crumble.ControllerId,
                    Is.EqualTo(IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId));
                Assert.That(builder.CurrentInstance.Environment.GetControllerState(crumble.ControllerId),
                    Is.EqualTo("Intact"));
                Assert.That(crumble.gameObject.activeSelf, Is.True);
                Assert.That(crumble.GetComponent<MeshCollider>(), Is.Not.Null);
                Assert.That(crumble.GetComponentInChildren<DungeonCrumbleSurfaceRelayV2>(true),
                    Is.Not.Null);

                builder.TearDown();

                Assert.That(root == null, Is.True);
                Assert.That(moving == null, Is.True);
                Assert.That(crumble == null, Is.True);
                Assert.That(host.transform.childCount, Is.Zero);
                Assert.That(builder.CurrentInstance, Is.Null);
            }
            finally
            {
                builder.TearDown();
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static DungeonPlanV2 GeneratePlanWithCertifiedTraversalMechanisms()
        {
            const int deterministicCandidateCount = 24;
            var generator = new IndustrialFactoryV2Generator();
            for (int index = 0; index < deterministicCandidateCount; index += 1)
            {
                DungeonPlanV2 candidate = generator.Generate(
                    "industrial-factory-v2-runtime-mechanisms-" + index);
                bool hasMovingPlatform = candidate.Surfaces.Any(surface =>
                    surface.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                    && surface.Kind == DungeonSurfaceKindV2.MovingPlatform);
                bool hasCredentialCrumble = candidate.Surfaces.Any(surface =>
                    surface.Source == DungeonSpatialRecordSourceV2.CertifiedModule
                    && surface.IsWalkable
                    && string.Equals(
                        surface.ControllerId,
                        IndustrialFactoryV2Ruleset.CredentialCrumbleControllerId,
                        StringComparison.Ordinal));
                if (hasMovingPlatform && hasCredentialCrumble)
                {
                    return candidate;
                }
            }

            Assert.Fail(
                "No deterministic authored candidate exposed both a certified MovingPlatform surface "
                + "and a certified walkable surface governed by the credential crumble controller.");
            return null;
        }

        [Test]
        public void EditModeTeardownImmediatelyDestroysEveryOwnedResourceAcrossCycles()
        {
            var host = new GameObject("DungeonV2ImmediateTeardownEditModeAcceptance");
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            var generator = new IndustrialFactoryV2Generator();
            try
            {
                for (int cycle = 0; cycle < 3; cycle += 1)
                {
                    DungeonPlanV2 plan = generator.Generate("industrial-factory-v2-edit-cycle-" + cycle);
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

                    builder.TearDown();

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
                UnityEngine.Object.DestroyImmediate(host);
            }
        }
    }
}
