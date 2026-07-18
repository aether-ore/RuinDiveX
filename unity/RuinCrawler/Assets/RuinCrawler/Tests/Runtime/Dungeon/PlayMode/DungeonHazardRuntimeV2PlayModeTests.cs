using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonHazardRuntimeV2PlayModeTests
    {
        private readonly List<GameObject> ownedObjects = new List<GameObject>();
        private TextAsset contractPack;

        [UnitySetUp]
        public IEnumerator RemovePersistentTestState()
        {
            if (CampaignSession.Instance != null)
            {
                UnityEngine.Object.Destroy(CampaignSession.Instance.gameObject);
            }

            if (UnityContractCatalogProvider.Instance != null)
            {
                UnityEngine.Object.Destroy(UnityContractCatalogProvider.Instance.gameObject);
            }

            yield return null;
        }

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            for (int index = ownedObjects.Count - 1; index >= 0; index -= 1)
            {
                if (ownedObjects[index] != null)
                {
                    UnityEngine.Object.Destroy(ownedObjects[index]);
                }
            }

            ownedObjects.Clear();
            if (CampaignSession.Instance != null)
            {
                UnityEngine.Object.Destroy(CampaignSession.Instance.gameObject);
            }

            if (UnityContractCatalogProvider.Instance != null)
            {
                UnityEngine.Object.Destroy(UnityContractCatalogProvider.Instance.gameObject);
            }

            if (contractPack != null)
            {
                UnityEngine.Object.Destroy(contractPack);
                contractPack = null;
            }

            yield return null;
            LogAssert.NoUnexpectedReceived();
        }

        [UnityTest]
        public IEnumerator AdjacentMagmaRelaysPreserveOccupancyAcrossTileSeams()
        {
            DungeonHazardDistrictRuntimeV2 district = CreateDistrict(
                DungeonHazardSurfaceKindV2.Magma,
                "magma-district-seam");
            DungeonHazardTileRelayV2 first = CreateRelay("magma-tile-a", district);
            DungeonHazardTileRelayV2 second = CreateRelay("magma-tile-b", district);
            HealthComponent health = CreateReceiver("player-seam", 160f);

            first.NotifyReceiverEnter(health);
            Assert.That(district.TryGetOccupancyId(health, out string occupancyBefore), Is.True);
            district.AdvanceSimulation(0.4d);
            Assert.That(health.Snapshot.Current, Is.EqualTo(160d).Within(1e-9));

            first.NotifyReceiverExit(health);
            second.NotifyReceiverEnter(health);
            Assert.That(district.TryGetOccupancyId(health, out string occupancyAcrossSeam), Is.True);
            Assert.That(occupancyAcrossSeam, Is.EqualTo(occupancyBefore));
            district.AdvanceSimulation(0.1d);
            Assert.That(health.Snapshot.Current, Is.EqualTo(157d).Within(1e-9));

            second.NotifyReceiverExit(health);
            district.AdvanceSimulation(0.05d);
            first.NotifyReceiverEnter(health);
            Assert.That(district.TryGetOccupancyId(health, out string occupancyWithinHysteresis), Is.True);
            Assert.That(occupancyWithinHysteresis, Is.EqualTo(occupancyBefore));

            first.NotifyReceiverExit(health);
            district.AdvanceSimulation(0.1d);
            Assert.That(district.TryGetOccupancyId(health, out _), Is.False);
            second.NotifyReceiverEnter(health);
            Assert.That(district.TryGetOccupancyId(health, out string newOccupancy), Is.True);
            Assert.That(newOccupancy, Is.Not.EqualTo(occupancyBefore));
            yield return null;
        }

        [UnityTest]
        public IEnumerator LargeMagmaFrameAppliesEveryPulseOnceAndReplayIsDuplicate()
        {
            DungeonHazardDistrictRuntimeV2 district = CreateDistrict(
                DungeonHazardSurfaceKindV2.Magma,
                "magma-district-large-frame");
            DungeonHazardTileRelayV2 relay = CreateRelay("magma-large-frame-tile", district);
            HealthComponent health = CreateReceiver("player-large-frame", 160f);
            var pulses = new List<EnvironmentalHazardPulseV2>();
            var results = new List<DamageResult>();
            district.PulseApplied += (receiver, pulse, result) =>
            {
                pulses.Add(pulse);
                results.Add(result);
            };

            relay.NotifyReceiverEnter(health);
            district.AdvanceSimulation(2d);

            Assert.That(pulses, Has.Count.EqualTo(7));
            Assert.That(pulses.Select(value => value.ExecutionId).Distinct().Count(), Is.EqualTo(7));
            Assert.That(results.All(value => value.WasApplied), Is.True);
            Assert.That(health.Snapshot.Current, Is.EqualTo(139d).Within(1e-9));

            DamageResult replay = district.ApplyPulse(health, pulses[0]);
            Assert.That(replay.WasDuplicate, Is.True);
            Assert.That(health.Snapshot.Current, Is.EqualTo(139d).Within(1e-9));
            yield return null;
        }

        [UnityTest]
        public IEnumerator ElectricClockContinuesWhilePlayerLeavesAndReentersDistrict()
        {
            DungeonHazardDistrictRuntimeV2 district = CreateDistrict(
                DungeonHazardSurfaceKindV2.Electric,
                "electric-district-reentry");
            DungeonHazardTileRelayV2 relay = CreateRelay("electric-tile", district);
            HealthComponent health = CreateReceiver("player-electric", 160f);
            var pulses = new List<EnvironmentalHazardPulseV2>();
            district.PulseApplied += (receiver, pulse, result) => pulses.Add(pulse);

            relay.NotifyReceiverEnter(health);
            district.AdvanceSimulation(1.5d);
            Assert.That(district.VisualPhase, Is.EqualTo(DungeonHazardVisualPhaseV2.ElectricCharging));

            relay.NotifyReceiverExit(health);
            district.AdvanceSimulation(0.4d);
            Assert.That(district.ActiveReceiverCount, Is.Zero);
            Assert.That(district.ElectricState.ElapsedInCycle, Is.EqualTo(1.9d).Within(1e-9));

            relay.NotifyReceiverEnter(health);
            district.AdvanceSimulation(0.35d);
            Assert.That(district.ElectricState.ElapsedInCycle, Is.EqualTo(2.25d).Within(1e-9));
            Assert.That(district.VisualPhase, Is.EqualTo(DungeonHazardVisualPhaseV2.ElectricEnergized));
            Assert.That(pulses, Has.Count.EqualTo(1));
            Assert.That(health.Snapshot.Current, Is.EqualTo(157.75d).Within(1e-9));
            yield return null;
        }

        [UnityTest]
        public IEnumerator EquippedHeatResistMakesTaggedMagmaPulseImmune()
        {
            CampaignSession session = CreateMemoryBackedCampaignSession();
            CampaignStateV1 state = session.Snapshot;
            state.ownedGearIds.Add("heatResistChip");
            state.gearAssignments.Add(new LoadoutAssignmentV1
            {
                slotId = "utility1",
                itemId = "heatResistChip"
            });
            Assert.That(session.Commit("hazard-test-equip-heat-resist", state).Success, Is.True);

            DungeonHazardDistrictRuntimeV2 district = CreateDistrict(
                DungeonHazardSurfaceKindV2.Magma,
                "magma-district-heat-resist");
            DungeonHazardTileRelayV2 relay = CreateRelay("magma-heat-resist-tile", district);
            HealthComponent health = CreateReceiver("player-heat-resist", 160f);
            health.gameObject.AddComponent<PlayerEnvironmentalProtection>();
            DamageResult observed = null;
            district.PulseApplied += (receiver, pulse, result) => observed = result;

            relay.NotifyReceiverEnter(health);
            district.AdvanceSimulation(0.5d);

            Assert.That(observed, Is.Not.Null);
            Assert.That(observed.WasImmune, Is.True);
            Assert.That(observed.MitigationReasonId, Is.EqualTo("gear:heatResistChip"));
            Assert.That(observed.Packet.DamageDomain, Is.EqualTo("environment"));
            Assert.That(observed.Packet.HazardTags, Does.Contain("environmentalHeat"));
            Assert.That(observed.Packet.HazardTags, Does.Contain("fireFloor"));
            Assert.That(health.Snapshot.Current, Is.EqualTo(160d).Within(1e-9));
            yield return null;
        }

        [UnityTest]
        public IEnumerator BuilderWiresHazardSurfacesToOneSharedDistrictClock()
        {
            GameObject host = Own(new GameObject("DungeonHazardBuilderIntegration"));
            DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                .Generate("industrial-factory-v2-hazard-runtime-integration");

            Assert.That(builder.TryBuild(plan, null, null, out string error), Is.True, error);
            int expectedHazards = plan.Surfaces.Count(value => value.Kind == DungeonSurfaceKindV2.Hazard);
            DungeonHazardTileRelayV2[] relays = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonHazardTileRelayV2>(true);
            DungeonHazardSurfaceVisualV2[] visuals = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonHazardSurfaceVisualV2>(true);
            DungeonHazardDistrictRuntimeV2[] districts = builder.GeneratedRoot
                .GetComponentsInChildren<DungeonHazardDistrictRuntimeV2>(true);

            Assert.That(relays, Has.Length.EqualTo(expectedHazards));
            Assert.That(visuals, Has.Length.EqualTo(expectedHazards));
            Assert.That(districts, Has.Length.EqualTo(1));
            Assert.That(relays.All(value => value.District == districts[0]), Is.True);
            Assert.That(visuals.All(value => value.VisualPhase == districts[0].VisualPhase), Is.True);
            yield return null;
        }

        private DungeonHazardDistrictRuntimeV2 CreateDistrict(
            DungeonHazardSurfaceKindV2 kind,
            string controllerId)
        {
            GameObject target = Own(new GameObject("HazardDistrictTest_" + controllerId));
            DungeonHazardDistrictRuntimeV2 district = target.AddComponent<DungeonHazardDistrictRuntimeV2>();
            district.Configure(kind, controllerId, targetEnvironment: null, simulateAutomatically: false);
            return district;
        }

        private DungeonHazardTileRelayV2 CreateRelay(
            string relayId,
            DungeonHazardDistrictRuntimeV2 district)
        {
            GameObject target = Own(new GameObject("HazardRelayTest_" + relayId));
            var trigger = target.AddComponent<BoxCollider>();
            trigger.isTrigger = true;
            DungeonHazardTileRelayV2 relay = target.AddComponent<DungeonHazardTileRelayV2>();
            relay.Configure(relayId, district);
            return relay;
        }

        private HealthComponent CreateReceiver(string receiverId, float maximumHealth)
        {
            GameObject target = Own(new GameObject("HazardReceiverTest_" + receiverId));
            target.AddComponent<DungeonHazardReceiverIdentityV2>().Configure(receiverId);
            HealthComponent health = target.AddComponent<HealthComponent>();
            health.Configure(maximumHealth);
            return health;
        }

        private CampaignSession CreateMemoryBackedCampaignSession()
        {
            GameObject root = Own(new GameObject("HazardTest_PersistentServices"));
            root.SetActive(false);
            CampaignSession session = root.AddComponent<CampaignSession>();
            session.ConfigureStoreForTests(new InMemoryCampaignStore());
            string contractPath = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "../../../assets/contracts/ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(contractPath), Is.True, "The exported contract pack is required.");
            contractPack = new TextAsset(File.ReadAllText(contractPath));
            UnityContractCatalogProvider provider = root.AddComponent<UnityContractCatalogProvider>();
            provider.Configure(contractPack);
            root.SetActive(true);
            Assert.That(session.HasDurableState, Is.True);
            Assert.That(provider.Catalog, Is.Not.Null);
            return session;
        }

        private GameObject Own(GameObject target)
        {
            ownedObjects.Add(target);
            return target;
        }

        private sealed class InMemoryCampaignStore : ICampaignEnvelopeStore<CampaignStateV1>
        {
            private CampaignEnvelopeV1<CampaignStateV1> envelope;

            public CampaignLoadResult<CampaignStateV1> Load(string saveContextId)
            {
                return envelope == null
                    ? new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.NotFound)
                    : new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.Loaded, envelope);
            }

            public CampaignCommitResult<CampaignStateV1> Commit(
                CampaignCommitRequest<CampaignStateV1> request)
            {
                CampaignCommitResult<CampaignStateV1> result =
                    CampaignTransactions.PrepareCommit(envelope, request);
                if (result.Success)
                {
                    envelope = result.Envelope;
                }

                return result;
            }
        }
    }
}
