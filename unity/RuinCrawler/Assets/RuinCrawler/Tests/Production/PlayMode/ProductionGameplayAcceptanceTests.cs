using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Port.Porting;
using RuinCrawler.Runtime.BossHunts;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Expedition;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using RuinCrawler.Runtime.Reaverbots;
using RuinCrawler.Runtime.Roll;
using RuinCrawler.UI.Hud;
using RuinCrawler.UI.Workshop;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
using UnityEngine.UIElements;

namespace RuinCrawler.Production.Tests
{
    public sealed class ProductionGameplayAcceptanceTests
    {
        private static TextAsset inMemoryContractPack;

        [UnitySetUp]
        public IEnumerator CreateIsolatedScene()
        {
            Scene isolation = SceneManager.GetSceneByName("ProductionAcceptanceIsolation");
            if (!isolation.IsValid() || !isolation.isLoaded)
            {
                isolation = SceneManager.CreateScene("ProductionAcceptanceIsolation");
            }
            SceneManager.SetActiveScene(isolation);

            Scene[] loadedScenes = Enumerable.Range(0, SceneManager.sceneCount)
                .Select(SceneManager.GetSceneAt)
                .Where(value => value != isolation
                                && value.isLoaded
                                && !string.IsNullOrEmpty(value.path)
                                && value.path.StartsWith("Assets/RuinCrawler/Scenes/"))
                .ToArray();
            foreach (Scene loaded in loadedScenes)
            {
                foreach (GameObject root in loaded.GetRootGameObjects())
                {
                    Object.Destroy(root);
                }
            }

            DestroyPersistentServices();
            if (CombatWorld.Instance != null)
            {
                Object.Destroy(CombatWorld.Instance.gameObject);
            }
            yield return null;
        }

        [UnityTearDown]
        public IEnumerator RemovePersistentServices()
        {
            DestroyPersistentServices();
            if (CombatWorld.Instance != null)
            {
                Object.Destroy(CombatWorld.Instance.gameObject);
            }
            yield return null;
            LogAssert.NoUnexpectedReceived();
        }

        [UnityTest]
        public IEnumerator BootRoutesToCampWithIsolatedPersistentServices()
        {
            CreateMemoryBackedCampaignSession();
            yield return SceneManager.LoadSceneAsync("Boot", LoadSceneMode.Single);

            float timeout = 3f;
            while (SceneManager.GetActiveScene().name != "Camp" && timeout > 0f)
            {
                timeout -= Time.unscaledDeltaTime;
                yield return null;
            }

            Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo("Camp"));
            AssertPersistentServiceContract();
            Assert.That(Object.FindAnyObjectByType<ProductionPlayerController>(), Is.Not.Null);
            RuinCrawlerHudController hud = Object.FindAnyObjectByType<RuinCrawlerHudController>();
            RollWorkshopController workshop = Object.FindAnyObjectByType<RollWorkshopController>();
            Assert.That(hud, Is.Not.Null);
            Assert.That(workshop, Is.Not.Null);
            AssertThemedPanel(hud.GetComponent<UIDocument>(), "HUD");
            AssertThemedPanel(workshop.GetComponent<UIDocument>(), "Roll workshop");
            Assert.That(Object.FindAnyObjectByType<RollWorkshopAnimator>(), Is.Not.Null);
        }

        [UnityTest]
        public IEnumerator ProductionGameplayScenesLoadWithPlayerCompiledWeaponHudAndServices()
        {
            CampaignSession session = CreateMemoryBackedCampaignSession();
            string[] scenes = { "Camp", "Expedition", "TestRange" };
            foreach (string sceneName in scenes)
            {
                if (sceneName == "Expedition")
                {
                    WorkshopTransactionResult planned =
                        ExpeditionFlowController.CreateBeginExpeditionTransaction(
                            session.Snapshot,
                            "acceptance-v2-scene-expedition",
                            "acceptance-v2-scene-seed");
                    Assert.That(planned.Success, Is.True, planned.Message ?? planned.FailureCode);
                    Assert.That(session.Commit("acceptance-v2-scene-entry", planned.State).Success, Is.True);
                }

                yield return SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Single);
                yield return null;

                if (sceneName == "Expedition")
                {
                    ExpeditionRuntimeController expedition =
                        Object.FindAnyObjectByType<ExpeditionRuntimeController>();
                    Assert.That(expedition, Is.Not.Null);
                    float generationTimeout = 8f;
                    while ((expedition.Plan == null
                            || Object.FindAnyObjectByType<DungeonSceneBuilderV2>()?.GeneratedRoot == null)
                           && generationTimeout > 0f)
                    {
                        generationTimeout -= Time.unscaledDeltaTime;
                        yield return null;
                    }
                }

                Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo(sceneName));
                AssertPersistentServiceContract();
                Assert.That(Object.FindAnyObjectByType<ProductionServicesBootstrap>(), Is.Not.Null);

                ProductionPlayerController player = Object.FindAnyObjectByType<ProductionPlayerController>();
                Assert.That(player, Is.Not.Null, sceneName + " must have the production player.");
                Assert.That(player.Vitality.Snapshot.Maximum, Is.EqualTo(160d).Within(0.0001d));
                Assert.That(player.LockOn, Is.Not.Null);

                MegaBusterWeaponController weapon = player.GetComponent<MegaBusterWeaponController>();
                Assert.That(weapon, Is.Not.Null);
                Assert.That(weapon.Plan, Is.Not.Null);
                Assert.That(weapon.Plan.IsMegaBuster, Is.True);
                Assert.That(weapon.Telemetry.MaximumEnergy, Is.GreaterThan(0d));
                Assert.That(Object.FindAnyObjectByType<ProductionProjectilePool>(), Is.Not.Null);
                RuinCrawlerHudController hud = Object.FindAnyObjectByType<RuinCrawlerHudController>();
                Assert.That(hud, Is.Not.Null);
                AssertThemedPanel(hud.GetComponent<UIDocument>(), sceneName + " HUD");

                if (sceneName == "Camp")
                {
                    RollWorkshopController workshop = Object.FindAnyObjectByType<RollWorkshopController>();
                    Assert.That(workshop, Is.Not.Null);
                    AssertThemedPanel(workshop.GetComponent<UIDocument>(), "Roll workshop");
                    Assert.That(Object.FindAnyObjectByType<RollWorkshopInteraction>(), Is.Not.Null);
                }
                else if (sceneName == "Expedition")
                {
                    ExpeditionRuntimeController expedition =
                        Object.FindAnyObjectByType<ExpeditionRuntimeController>();
                    DungeonSceneBuilderV2 dungeon = Object.FindAnyObjectByType<DungeonSceneBuilderV2>();
                    ReaverbotSpawner spawner = Object.FindAnyObjectByType<ReaverbotSpawner>();
                    Assert.That(expedition, Is.Not.Null);
                    Assert.That(expedition.LastError, Is.Null.Or.Empty);
                    Assert.That(expedition.Plan, Is.Not.Null);
                    Assert.That(dungeon, Is.Not.Null);
                    Assert.That(
                        new IndustrialFactoryV2Validator().Validate(dungeon.CurrentPlan).Accepted,
                        Is.True);
                    Assert.That(dungeon.GeneratedRoot, Is.Not.Null);
                    Assert.That(spawner, Is.Not.Null);
                    Assert.That(
                        dungeon.GeneratedRoot.GetComponentsInChildren<DungeonAnchorRuntimeV2>(true)
                            .Count(value => value.Kind == DungeonAnchorKindV2.Encounter),
                        Is.GreaterThan(0),
                        "The generated plan must provide region-activated encounter slots.");
                    Assert.That(spawner.ActiveCount, Is.EqualTo(expedition.SpawnedEnemyCount));
                    ReaverbotRuntimeController[] enemies = spawner.GetComponentsInChildren<ReaverbotRuntimeController>(true);
                    Assert.That(enemies.Count(value => value.gameObject.activeInHierarchy),
                        Is.EqualTo(expedition.SpawnedEnemyCount));
                    Assert.That(
                        enemies.Where(value => value.gameObject.activeInHierarchy)
                            .Select(value => value.GetComponent<CombatTargetComponent>())
                            .All(value => value != null && value.Kind == CombatTargetKind.Body),
                        Is.True,
                        "Every procedural enemy must expose its authoritative body target.");
                }
                else
                {
                    CombatTargetComponent[] bodies = Object.FindObjectsByType<CombatTargetComponent>(
                            FindObjectsInactive.Include)
                        .Where(value => value.Kind == CombatTargetKind.Body)
                        .ToArray();
                    Assert.That(bodies, Has.Length.EqualTo(3));
                    Assert.That(
                        bodies.Select(value => value.OwnerHealth.Snapshot.Maximum),
                        Is.All.EqualTo((double)SourceGameplayContract.SharukurusuHealth).Within(0.0001d));
                }
            }
        }

        [UnityTest]
        public IEnumerator RollWorkshopModalSuppressesGameplayAndProvidesDeterministicFocusNavigation()
        {
            CreateMemoryBackedCampaignSession();
            yield return SceneManager.LoadSceneAsync("Camp", LoadSceneMode.Single);
            yield return null;

            ProductionPlayerController player = Object.FindAnyObjectByType<ProductionPlayerController>();
            RollWorkshopController workshop = Object.FindAnyObjectByType<RollWorkshopController>();
            Assert.That(player, Is.Not.Null);
            Assert.That(workshop, Is.Not.Null);

            FieldInfo inputField = typeof(ProductionPlayerController).GetField(
                "inputActions",
                BindingFlags.Instance | BindingFlags.NonPublic);
            InputActionAsset input = inputField?.GetValue(player) as InputActionAsset;
            InputActionMap gameplay = input?.FindActionMap("Gameplay", false);
            Assert.That(gameplay, Is.Not.Null);
            Assert.That(gameplay.enabled, Is.True);

            workshop.Open();
            yield return null;

            Assert.That(workshop.IsOpen, Is.True);
            Assert.That(gameplay.enabled, Is.False, "Opening Roll's modal must disable the complete Gameplay action map.");
            UIDocument workshopDocument = workshop.GetComponent<UIDocument>();
            Assert.That(workshopDocument.sortingOrder, Is.EqualTo(900));
            Assert.That(workshopDocument.panelSettings.sortingOrder, Is.EqualTo(900));
            VisualElement root = workshopDocument.rootVisualElement;
            Button identify = root.Q<Button>("roll-identify-all");
            Assert.That(identify, Is.Not.Null);
            Assert.That(identify.enabledInHierarchy, Is.False);
            Assert.That(identify.tooltip, Does.Contain("No unidentified recoveries"));

            Assert.That(workshop.TryFocusControl("roll-tab-salvage"), Is.True);
            workshop.NavigateFocus(1);
            Assert.That(workshop.FocusedControlName, Is.Not.Null.And.Not.EqualTo("roll-tab-salvage"));
            Assert.That(workshop.TryFocusControl("roll-tab-fabrication"), Is.True);
            Assert.That(workshop.ActivateFocusedControl(), Is.True);
            Assert.That(workshop.CurrentTabId, Is.EqualTo("Fabrication"));

            Assert.That(workshop.TryShowSection("BusterLab"), Is.True);
            Button testRange = root.Q<Button>("roll-buster-test-range");
            Assert.That(testRange, Is.Not.Null);
            Assert.That(testRange.enabledInHierarchy, Is.False);
            Assert.That(testRange.tooltip, Does.Contain("validation errors"));

            Assert.That(workshop.TryShowSection("BossHunts"), Is.True);
            Button depart = root.Q<Button>("roll-support-car-depart");
            Assert.That(depart, Is.Not.Null);
            Assert.That(depart.enabledInHierarchy, Is.True,
                "The EXPEDITIONS tab must permit a standard dungeon without a Boss Hunt selection.");
            Assert.That(depart.tooltip, Does.Contain("without selecting a Boss Hunt"));

            workshop.Close();
            yield return null;
            Assert.That(gameplay.enabled, Is.True, "Closing Roll's modal must restore Gameplay input.");
        }

        [UnityTest]
        public IEnumerator CampInteractionsOpenRollWorkshopAndProvideDirectDungeonDeparture()
        {
            CampaignSession session = CreateMemoryBackedCampaignSession();
            yield return SceneManager.LoadSceneAsync("Camp", LoadSceneMode.Single);
            yield return null;

            ProductionPlayerController player = Object.FindAnyObjectByType<ProductionPlayerController>();
            RollWorkshopController workshop = Object.FindAnyObjectByType<RollWorkshopController>();
            RollWorkshopInteraction rollInteraction = Object.FindAnyObjectByType<RollWorkshopInteraction>();
            CampExpeditionInteraction departure = Object.FindAnyObjectByType<CampExpeditionInteraction>();
            Assert.That(player, Is.Not.Null);
            Assert.That(workshop, Is.Not.Null);
            Assert.That(rollInteraction, Is.Not.Null);
            Assert.That(departure, Is.Not.Null);

            MovePlayerTo(player, rollInteraction.transform.position + Vector3.forward);
            yield return null;
            Assert.That(rollInteraction.IsPlayerInRange, Is.True);
            Assert.That(rollInteraction.Prompt.gameObject.activeSelf, Is.True);
            Assert.That(rollInteraction.Prompt.text, Does.Contain("F / X"));
            Assert.That(rollInteraction.TryInteract(), Is.True);
            yield return null;
            Assert.That(workshop.IsOpen, Is.True);

            Button standardDeparture = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-standard-expedition-depart");
            Assert.That(standardDeparture, Is.Not.Null);
            Assert.That(standardDeparture.enabledInHierarchy, Is.True,
                "A normal dungeon departure must not require selecting a Boss Hunt.");
            Assert.That(standardDeparture.tooltip, Does.Contain("without selecting a Boss Hunt"));
            workshop.Close();
            yield return null;

            MovePlayerTo(player, departure.transform.position + Vector3.forward);
            yield return null;
            Assert.That(departure.IsPlayerInRange, Is.True);
            Assert.That(departure.Prompt.gameObject.activeSelf, Is.True);
            Assert.That(departure.Prompt.text, Does.Contain("F / X"));
            Assert.That(departure.TryBeginExpedition("acceptance-camp-access"), Is.True);
            yield return null;

            Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo("Expedition"));
            Assert.That(session.Snapshot.expedition.runSeed, Is.EqualTo("acceptance-camp-access"));
            Assert.That(session.Snapshot.expedition.bossProfileId, Is.Null.Or.Empty,
                "The direct Camp departure is a normal procedural expedition on a fresh campaign.");
        }

        [UnityTest]
        public IEnumerator CampReentersPersistedExpeditionWithoutReplacingItsDeterministicSource()
        {
            const string profileId = "rubyOpticOracle";
            const string expeditionId = "acceptance-resume-expedition";
            const string runSeed = "acceptance-resume-seed";

            CampaignSession session = CreateMemoryBackedCampaignSession();
            WorkshopTransactionResult selected = RollWorkshopService.SelectBossHunt(
                session.Snapshot,
                profileId,
                profileExists: true);
            Assert.That(selected.Success, Is.True);
            WorkshopTransactionResult begun = ExpeditionFlowController.CreateBeginExpeditionTransaction(
                selected.State,
                expeditionId,
                runSeed);
            Assert.That(begun.Success, Is.True);
            Assert.That(session.Commit("acceptance-seed-resumable-expedition", begun.State).Success, Is.True);

            yield return SceneManager.LoadSceneAsync("Camp", LoadSceneMode.Single);
            yield return null;

            ProductionPlayerController player = Object.FindAnyObjectByType<ProductionPlayerController>();
            CampExpeditionInteraction departure = Object.FindAnyObjectByType<CampExpeditionInteraction>();
            Assert.That(player, Is.Not.Null);
            Assert.That(departure, Is.Not.Null);
            MovePlayerTo(player, departure.transform.position + Vector3.forward);
            yield return null;

            Assert.That(departure.Prompt.gameObject.activeSelf, Is.True);
            Assert.That(departure.Prompt.text, Does.Contain("RE-ENTER RUIN"));
            Assert.That(departure.TryBeginExpedition("must-not-replace-active-seed"), Is.True);
            yield return null;

            Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo("Expedition"));
            CampaignStateV1 resumed = session.Snapshot;
            Assert.That(resumed.bossHunts.activeExpeditionId, Is.EqualTo(expeditionId));
            Assert.That(resumed.bossHunts.selectionLocked, Is.True);
            Assert.That(resumed.expedition.expeditionId, Is.EqualTo(expeditionId));
            Assert.That(resumed.expedition.runSeed, Is.EqualTo(runSeed));
            Assert.That(
                resumed.expedition.dungeonProfileId,
                Is.EqualTo(ExpeditionFlowController.IndustrialFactoryV2ProfileId));
            Assert.That(resumed.expedition.bossProfileId, Is.EqualTo(profileId));
            Assert.That(resumed.expedition.dungeonPlanId, Is.EqualTo(begun.State.expedition.dungeonPlanId),
                "Re-entry must reconstruct the committed plan rather than create another expedition.");
        }

        [UnityTest]
        public IEnumerator PlayerDefeatReturnsToCampAndPreservesTheExpeditionForReentry()
        {
            const string expeditionId = "acceptance-defeat-expedition";
            const string runSeed = "acceptance-defeat-seed";

            CampaignSession session = CreateMemoryBackedCampaignSession();
            WorkshopTransactionResult begun = ExpeditionFlowController.CreateBeginExpeditionTransaction(
                session.Snapshot,
                expeditionId,
                runSeed);
            Assert.That(begun.Success, Is.True);
            Assert.That(session.Commit("acceptance-seed-defeat-expedition", begun.State).Success, Is.True);

            yield return SceneManager.LoadSceneAsync("Expedition", LoadSceneMode.Single);
            yield return null;
            ProductionPlayerController player = Object.FindAnyObjectByType<ProductionPlayerController>();
            Assert.That(player, Is.Not.Null);

            DamageResult lethal = player.Vitality.ApplyDamage(new DamagePacket(
                100000d,
                "acceptance-player-defeat",
                "acceptance-enemy",
                armorPierce: double.PositiveInfinity,
                suppressRewards: true));
            Assert.That(lethal.TargetDied, Is.True);

            float returnTimeout = 4f;
            while (SceneManager.GetActiveScene().name != "Camp" && returnTimeout > 0f)
            {
                returnTimeout -= Time.unscaledDeltaTime;
                yield return null;
            }

            Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo("Camp"));
            CampaignStateV1 afterDefeat = session.Snapshot;
            Assert.That(afterDefeat.bossHunts.activeExpeditionId, Is.EqualTo(expeditionId));
            Assert.That(afterDefeat.bossHunts.selectionLocked, Is.True);
            Assert.That(afterDefeat.expedition.expeditionId, Is.EqualTo(expeditionId));
            Assert.That(afterDefeat.expedition.runSeed, Is.EqualTo(runSeed));
            Assert.That(afterDefeat.bossHunts.victoryHistory, Is.Empty);
            Assert.That(afterDefeat.bossHunts.resolvedVictoryIds, Is.Empty);
            Assert.That(afterDefeat.expedition.dungeonPlanId, Is.EqualTo(begun.State.expedition.dungeonPlanId),
                "Defeat must preserve the committed generated plan without awarding victory.");

            ProductionPlayerController campPlayer = Object.FindAnyObjectByType<ProductionPlayerController>();
            CampExpeditionInteraction campDeparture = Object.FindAnyObjectByType<CampExpeditionInteraction>();
            Assert.That(campPlayer, Is.Not.Null);
            Assert.That(campPlayer.Vitality.Snapshot.Current, Is.EqualTo(160d).Within(0.001d));
            Assert.That(campDeparture, Is.Not.Null);
            MovePlayerTo(campPlayer, campDeparture.transform.position + Vector3.forward);
            yield return null;
            Assert.That(campDeparture.Prompt.text, Does.Contain("RE-ENTER RUIN"));
            Assert.That(campDeparture.TryBeginExpedition(), Is.True);
            yield return null;
            Assert.That(SceneManager.GetActiveScene().name, Is.EqualTo("Expedition"));
            Assert.That(session.Snapshot.expedition.runSeed, Is.EqualTo(runSeed));
            Assert.That(session.Snapshot.expedition.expeditionId, Is.EqualTo(expeditionId));
        }

        [UnityTest]
        public IEnumerator RollWorkshopActionsCommitIdentifyAllAndLockBossSelectionBeforeDeparture()
        {
            CampaignSession session = CreateMemoryBackedCampaignSession();
            CampaignStateV1 seeded = session.Snapshot;
            seeded.unidentifiedRecoveries.Add(new UnidentifiedRecoveryV1
            {
                recoveryId = "acceptance-recovery-1",
                sourceKind = "weapon",
                sourceId = "pulseCannon",
                sequence = 1,
                quantity = 2,
                recoverableParts = new System.Collections.Generic.List<RecoveryPartV1>
                {
                    new RecoveryPartV1
                    {
                        materialId = "revolvingPulseBarrel",
                        name = "Revolving Pulse Barrel",
                        family = "Pulse Weapon",
                        aspect = "weapon",
                        tier = "uncommon",
                        quantity = 1
                    }
                }
            });
            Assert.That(session.Commit("acceptance-seed-recovery", seeded).Success, Is.True);

            yield return SceneManager.LoadSceneAsync("Camp", LoadSceneMode.Single);
            yield return null;

            RollWorkshopController workshop = Object.FindAnyObjectByType<RollWorkshopController>();
            Assert.That(workshop, Is.Not.Null);
            workshop.Open();
            yield return null;
            Assert.That(workshop.TryFocusControl("roll-identify-all"), Is.True);
            Assert.That(workshop.ActivateFocusedControl(), Is.True);
            yield return null;

            CampaignStateV1 identified = session.Snapshot;
            Assert.That(identified.unidentifiedRecoveries, Is.Empty);
            Assert.That(identified.resolvedRecoveryIds, Does.Contain("acceptance-recovery-1"));
            Assert.That(identified.salvage.parts.Single(value =>
                value.materialId == "revolvingPulseBarrel").quantity, Is.EqualTo(1));
            Assert.That(identified.salvage.identifiedScrap, Is.EqualTo(1));

            Assert.That(workshop.TryShowSection("BossHunts"), Is.True);
            string bossId = UnityContractCatalogProvider.Instance.Catalog.BossProfiles.Keys.OrderBy(value => value).First();
            Assert.That(workshop.TryFocusControl("roll-boss-select-" + bossId), Is.True);
            Assert.That(workshop.ActivateFocusedControl(), Is.True);
            yield return null;
            Assert.That(session.Snapshot.bossHunts.selectedProfileId, Is.EqualTo(bossId));
            Button depart = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-support-car-depart");
            Assert.That(depart.enabledInHierarchy, Is.True);

            CampaignStateV1 selected = session.Snapshot;
            WorkshopTransactionResult planned =
                ExpeditionFlowController.CreateBeginExpeditionTransaction(
                    selected,
                    "acceptance-expedition",
                    "acceptance-seed");
            Assert.That(planned.Success, Is.True);
            Assert.That(session.Commit("acceptance-begin-expedition", planned.State).Success, Is.True);
            yield return null;

            Button selectedButton = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-boss-select-" + bossId);
            depart = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-support-car-depart");
            Assert.That(selectedButton.enabledInHierarchy, Is.False);
            Assert.That(selectedButton.tooltip, Does.Contain("locked"));
            Assert.That(depart.enabledInHierarchy, Is.True,
                "A committed expedition must remain re-enterable after a reload or defeat.");
            Assert.That(depart.text, Does.Contain("RE-ENTER ACTIVE EXPEDITION"));
            Assert.That(depart.tooltip, Does.Contain("existing ID"));

            Button abandon = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-active-expedition-abandon");
            Assert.That(abandon, Is.Not.Null);
            Assert.That(abandon.enabledInHierarchy, Is.True);
            long revisionBeforeAbandon = session.Revision.Revision;
            Assert.That(workshop.TryFocusControl("roll-active-expedition-abandon"), Is.True);
            Assert.That(workshop.ActivateFocusedControl(), Is.True);
            yield return null;

            CampaignStateV1 abandoned = session.Snapshot;
            Assert.That(abandoned.bossHunts.activeExpeditionId, Is.Null.Or.Empty);
            Assert.That(abandoned.bossHunts.selectionLocked, Is.False);
            Assert.That(abandoned.expedition.expeditionId, Is.Null.Or.Empty);
            Assert.That(abandoned.bossHunts.selectedProfileId, Is.EqualTo(bossId),
                "Abandoning a run does not silently change the selected Boss Hunt.");
            Assert.That(abandoned.bossHunts.victoryHistory, Is.Empty);
            Assert.That(session.Revision.Revision, Is.EqualTo(revisionBeforeAbandon + 1));

            string alternateBossId = UnityContractCatalogProvider.Instance.Catalog.BossProfiles.Keys
                .OrderBy(value => value)
                .First(value => !string.Equals(value, bossId, System.StringComparison.Ordinal));
            Button alternate = workshop.GetComponent<UIDocument>().rootVisualElement
                .Q<Button>("roll-boss-select-" + alternateBossId);
            Assert.That(alternate, Is.Not.Null);
            Assert.That(alternate.enabledInHierarchy, Is.True,
                "Abandoning the active run must immediately unlock Boss Hunt selection.");
        }

        [UnityTest]
        public IEnumerator SelectedBossHuntExpeditionSpawnsCommitsOnceAndTearsDownCleanly()
        {
            const string profileId = "rubyOpticOracle";
            const string expeditionId = "acceptance-boss-expedition";
            const string runSeed = "acceptance-boss-seed";

            CampaignSession session = CreateMemoryBackedCampaignSession();
            WorkshopTransactionResult selected = RollWorkshopService.SelectBossHunt(
                session.Snapshot,
                profileId,
                profileExists: true);
            Assert.That(selected.Success, Is.True);
            WorkshopTransactionResult departure = ExpeditionFlowController.CreateBeginExpeditionTransaction(
                selected.State,
                expeditionId,
                runSeed);
            Assert.That(departure.Success, Is.True);
            Assert.That(
                session.Commit("acceptance-begin-boss-expedition", departure.State).Success,
                Is.True);

            yield return SceneManager.LoadSceneAsync("Expedition", LoadSceneMode.Single);

            ExpeditionRuntimeController expedition = null;
            float generationTimeout = 10f;
            while (generationTimeout > 0f)
            {
                expedition = Object.FindAnyObjectByType<ExpeditionRuntimeController>();
                if (expedition?.Plan != null)
                {
                    break;
                }

                generationTimeout -= Time.unscaledDeltaTime;
                yield return null;
            }

            Assert.That(expedition, Is.Not.Null);
            Assert.That(expedition.LastError, Is.Null.Or.Empty);
            Assert.That(expedition.RunSeed, Is.EqualTo(runSeed));
            ProductionPlayerController expeditionPlayer =
                Object.FindAnyObjectByType<ProductionPlayerController>();
            Assert.That(expeditionPlayer, Is.Not.Null);
            DungeonRegionRuntimeV2 finalRegion = Object
                .FindObjectsByType<DungeonRegionRuntimeV2>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)
                .Single(value => value.StableId == expedition.Plan.ExtractionRegionId);
            MovePlayerTo(expeditionPlayer, finalRegion.GetComponent<Collider>().bounds.center);
            yield return new WaitForFixedUpdate();
            yield return null;
            BossHuntRuntimeController boss = expedition.ActiveBoss;
            Assert.That(boss, Is.Not.Null, "The selected hunt must replace the generated boss-room occupant.");
            Assert.That(boss.Plan.Profile.Id, Is.EqualTo(profileId));
            Assert.That(boss.Plan.Victory.ExpeditionId, Is.EqualTo(expeditionId));
            Assert.That(boss.Plan.Request.isBoss, Is.True);
            Assert.That(boss.Product.GeneratedRuntime, Is.Not.Null);
            Assert.That(boss.Product.GeneratedRuntime.AutomaticDespawn, Is.False);

            ReaverbotSpawner spawner = Object.FindAnyObjectByType<ReaverbotSpawner>();
            BossHuntCoordinator coordinator = Object.FindAnyObjectByType<BossHuntCoordinator>();
            DungeonSceneBuilderV2 dungeon = Object.FindAnyObjectByType<DungeonSceneBuilderV2>();
            Assert.That(spawner, Is.Not.Null);
            Assert.That(coordinator, Is.Not.Null);
            Assert.That(coordinator.ActiveEncounter, Is.SameAs(boss));
            Assert.That(spawner.ActiveCount, Is.EqualTo(expedition.SpawnedEnemyCount + 1),
                "The coordinator-owned boss is tracked by the shared spawner but excluded from ordinary slot ownership.");

            ReaverbotRuntimeController bossRuntime = boss.Product.GeneratedRuntime;
            bool observedBossDeath = false;
            UnidentifiedReaverbotRecovery genericBossRecovery = null;
            spawner.EnemyDefeated += (enemy, recovery) =>
            {
                if (enemy != bossRuntime) return;
                observedBossDeath = true;
                genericBossRecovery = recovery;
            };

            ProductionProjectilePool enemyProjectiles = spawner.GetComponentInChildren<ProductionProjectilePool>(true);
            Assert.That(enemyProjectiles, Is.Not.Null);
            Assert.That(bossRuntime.TryExecuteAttackImmediately(), Is.True);
            Assert.That(enemyProjectiles.ActiveCount, Is.GreaterThan(0),
                "The cleanup assertion must begin with a live boss-owned projectile.");

            long revisionBeforeVictory = session.Revision.Revision;
            boss.Product.Health.ApplyDamage(new DamagePacket(
                100000d,
                "acceptance-boss-lethal-hit",
                "acceptance-mega-buster",
                armorPierce: double.PositiveInfinity));

            Assert.That(observedBossDeath, Is.True);
            Assert.That(genericBossRecovery, Is.Null,
                "Boss Hunts suppress the generated Reaverbot pickup even when the lethal packet does not suppress rewards.");
            Assert.That(spawner.ActiveRecoveryCount, Is.Zero);
            Assert.That(boss.Phase, Is.EqualTo(BossPhaseState.Resolved));
            Assert.That(session.Revision.Revision, Is.GreaterThan(revisionBeforeVictory),
                "Victory resolution must durably commit the Boss Hunt result.");

            CampaignStateV1 resolved = session.Snapshot;
            Assert.That(resolved.bossHunts.resolvedVictoryIds, Does.Contain(boss.Plan.Victory.VictoryId));
            Assert.That(resolved.bossHunts.victoryHistory, Has.Count.EqualTo(1));
            Assert.That(resolved.bossHunts.victoryHistory[0].profileId, Is.EqualTo(profileId));
            Assert.That(resolved.bossHunts.victoryHistory[0].expeditionId, Is.EqualTo(expeditionId));
            Assert.That(resolved.bossHunts.victoryHistory[0].firstClear, Is.True);
            Assert.That(
                resolved.salvage.parts.Single(value =>
                    value.materialId == boss.Plan.Victory.FirstClearReward.MaterialId).quantity,
                Is.EqualTo(boss.Plan.Victory.FirstClearReward.Quantity));

            long revisionAfterVictory = session.Revision.Revision;
            boss.Product.Health.ApplyDamage(new DamagePacket(
                100000d,
                "acceptance-boss-duplicate-lethal-hit",
                "acceptance-mega-buster",
                armorPierce: double.PositiveInfinity));
            Assert.That(session.Revision.Revision, Is.EqualTo(revisionAfterVictory),
                "A repeated lethal packet must not commit or award the Boss Hunt twice.");
            Assert.That(session.Snapshot.bossHunts.victoryHistory, Has.Count.EqualTo(1));
            Assert.That(enemyProjectiles.ActiveCount, Is.GreaterThan(0),
                "The resolved encounter retains in-flight shots until the explicit teardown boundary.");

            expedition.TearDown();
            Assert.That(expedition.ActiveBoss, Is.Null);
            Assert.That(coordinator.HasActiveEncounter, Is.False);
            Assert.That(spawner.ActiveCount, Is.Zero);
            Assert.That(spawner.PooledCount, Is.Zero);
            Assert.That(spawner.ActiveRecoveryCount, Is.Zero);
            Assert.That(enemyProjectiles.ActiveCount, Is.Zero,
                "Boss reset must cancel every in-flight projectile owned by the stable boss source id.");
            Assert.That(dungeon.GeneratedRoot, Is.Null);
            yield return null;
        }

        [UnityTest]
        public IEnumerator CompiledMegaBusterRuntimeCollisionChangesSharukurusuHealthFrom68To60()
        {
            int targetLayer = LayerMask.NameToLayer("Targetable");
            Assert.That(targetLayer, Is.GreaterThanOrEqualTo(0));

            GameObject targetObject = GameObject.CreatePrimitive(PrimitiveType.Cube);
            targetObject.name = "Acceptance_SharukurusuBody";
            targetObject.layer = targetLayer;
            targetObject.transform.position = new Vector3(0f, 50f, 3f);
            HealthComponent health = targetObject.AddComponent<HealthComponent>();
            health.Configure(SourceGameplayContract.SharukurusuHealth);
            CombatTargetComponent target = targetObject.AddComponent<CombatTargetComponent>();
            target.Configure(
                "acceptance.sharukurusu.body",
                "acceptance.sharukurusu.body",
                "Sharukurusu",
                health,
                targetObject.transform);

            GameObject poolObject = new GameObject("Acceptance_ProjectilePool");
            poolObject.SetActive(false);
            ProductionProjectilePool pool = poolObject.AddComponent<ProductionProjectilePool>();
            pool.Configure(null, 1 << targetLayer, 24);
            poolObject.SetActive(true);

            GameObject weaponObject = new GameObject("Acceptance_MegaBuster");
            MegaBusterWeaponController weapon = weaponObject.AddComponent<MegaBusterWeaponController>();
            weapon.Configure(pool);
            Assert.That(weapon.Plan.IsMegaBuster, Is.True);
            Assert.That(
                weapon.Plan.RootPacket.DamagePower,
                Is.EqualTo((double)SourceGameplayContract.MegaBusterDamage).Within(0.0001d));

            yield return null;
            Assert.That(
                weapon.TryFire(new Vector3(0f, 50f, 0f), Vector3.forward),
                Is.True,
                "The neutral compiled Mega Buster should reserve and emit its shot.");

            float timeout = 1.5f;
            while (health.Snapshot.Current >= SourceGameplayContract.SharukurusuHealth && timeout > 0f)
            {
                timeout -= Time.deltaTime;
                yield return null;
            }

            Assert.That(
                health.Snapshot.Current,
                Is.EqualTo(60d).Within(0.0001d),
                "The swept projectile must deliver the typed 8-damage packet exactly once.");
            Assert.That(pool.ActiveCount, Is.EqualTo(0));

            Object.Destroy(weaponObject);
            Object.Destroy(poolObject);
            Object.Destroy(targetObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator LockSurvivesRangeAndCoveredWeakPointThenTransfersToOwnerBody()
        {
            GameObject player = new GameObject("Acceptance_LockOwner");
            player.transform.position = new Vector3(0f, 100f, 0f);
            LockOnController lockOn = player.AddComponent<LockOnController>();

            GameObject owner = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            owner.name = "Acceptance_TargetOwner";
            owner.transform.position = new Vector3(0f, 100f, 5f);
            HealthComponent health = owner.AddComponent<HealthComponent>();
            health.Configure(SourceGameplayContract.SharukurusuHealth);
            CombatTargetComponent body = owner.AddComponent<CombatTargetComponent>();
            body.Configure(
                "acceptance.target.body",
                "acceptance.target.body",
                "Sharukurusu",
                health,
                owner.transform);

            GameObject weakObject = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            weakObject.name = "Acceptance_CoveredWeakPoint";
            weakObject.transform.SetParent(owner.transform, false);
            weakObject.transform.localPosition = new Vector3(0f, 0f, -0.5f);
            CombatTargetComponent weak = weakObject.AddComponent<CombatTargetComponent>();
            weak.Configure(
                "acceptance.target.weak.ruby",
                "acceptance.target.body",
                "Sharukurusu",
                health,
                weakObject.transform,
                CombatTargetKind.WeakPoint,
                "Ruby Optic",
                0.3f,
                true,
                "acceptance.target.body",
                1.5f);

            yield return null;
            Assert.That(lockOn.TryAcquireNearest(true), Is.True);
            Assert.That(lockOn.CurrentTarget, Is.SameAs(weak));
            Assert.That(lockOn.IsLocked, Is.True);

            player.transform.position = new Vector3(0f, 100f, -100f);
            yield return null;
            Assert.That(
                lockOn.CurrentTarget,
                Is.SameAs(weak),
                "An established lock must not be dropped by a range excursion.");

            weak.SetTargetActive(false);
            yield return null;
            Assert.That(
                lockOn.CurrentTarget,
                Is.SameAs(weak),
                "A covered retainable weak point remains the sticky lock target.");

            weak.Configure(
                "acceptance.target.weak.ruby",
                "acceptance.target.body",
                "Sharukurusu",
                health,
                weakObject.transform,
                CombatTargetKind.WeakPoint,
                "Ruby Optic",
                0.3f,
                false,
                "acceptance.target.body",
                1.5f);
            yield return null;
            Assert.That(
                lockOn.CurrentTarget,
                Is.SameAs(body),
                "A broken non-retainable part must transfer lock to its explicit owner fallback.");

            Object.Destroy(player);
            Object.Destroy(owner);
            yield return null;
        }

        private static CampaignSession CreateMemoryBackedCampaignSession()
        {
            GameObject root = new GameObject("Acceptance_PersistentServices");
            root.SetActive(false);
            CampaignSession session = root.AddComponent<CampaignSession>();
            session.ConfigureStoreForTests(new InMemoryCampaignStore());
            string contractPath = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "../../../assets/contracts/ruin-crawler-contracts.v1.json"));
            Assert.That(File.Exists(contractPath), Is.True, "The exported contract pack is required.");
            inMemoryContractPack = new TextAsset(File.ReadAllText(contractPath));
            UnityContractCatalogProvider provider = root.AddComponent<UnityContractCatalogProvider>();
            provider.Configure(inMemoryContractPack);
            root.AddComponent<ExpeditionFlowController>();
            root.SetActive(true);
            Assert.That(session.HasDurableState, Is.True);
            return session;
        }

        private static void AssertPersistentServiceContract()
        {
            Assert.That(CampaignSession.Instance, Is.Not.Null);
            Assert.That(CampaignSession.Instance.HasDurableState, Is.True);
            Assert.That(UnityContractCatalogProvider.Instance, Is.Not.Null);
            Assert.That(UnityContractCatalogProvider.Instance.Catalog, Is.Not.Null);
            Assert.That(ExpeditionFlowController.Instance, Is.Not.Null);
        }

        private static void AssertThemedPanel(UIDocument document, string label)
        {
            Assert.That(document, Is.Not.Null, label + " must own a UIDocument.");
            Assert.That(document.panelSettings, Is.Not.Null, label + " must own PanelSettings.");
            Assert.That(
                document.panelSettings.themeStyleSheet,
                Is.Not.Null,
                label + " must use the shared runtime Theme Style Sheet.");
        }

        private static void MovePlayerTo(ProductionPlayerController player, Vector3 position)
        {
            CharacterController controller = player.GetComponent<CharacterController>();
            if (controller != null)
            {
                controller.enabled = false;
            }

            player.transform.position = position;
            if (controller != null)
            {
                controller.enabled = true;
            }
        }

        private static void DestroyPersistentServices()
        {
            if (CampaignSession.Instance != null)
            {
                Object.Destroy(CampaignSession.Instance.gameObject);
            }

            if (inMemoryContractPack != null)
            {
                Object.Destroy(inMemoryContractPack);
                inMemoryContractPack = null;
            }
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
