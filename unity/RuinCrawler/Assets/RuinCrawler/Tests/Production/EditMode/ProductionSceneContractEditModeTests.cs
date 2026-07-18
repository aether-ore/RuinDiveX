using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Port.Porting;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.BossHunts;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Expedition;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using RuinCrawler.Runtime.Reaverbots;
using RuinCrawler.Runtime.Roll;
using RuinCrawler.UI.Hud;
using RuinCrawler.UI.Workshop;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RuinCrawler.Production.Tests
{
    public sealed class ProductionSceneContractEditModeTests
    {
        private const string SceneRoot = "Assets/RuinCrawler/Scenes/";

        private static readonly string[] ExpectedBuildOrder =
        {
            SceneRoot + "Boot.unity",
            SceneRoot + "Camp.unity",
            SceneRoot + "Expedition.unity",
            SceneRoot + "TestRange.unity",
            SceneRoot + "PortingSandbox.unity"
        };

        [Test]
        public void ProductionScenesExistAndOwnStableBuildOrder()
        {
            foreach (string path in ExpectedBuildOrder.Take(4))
            {
                Assert.That(
                    AssetDatabase.LoadAssetAtPath<SceneAsset>(path),
                    Is.Not.Null,
                    "The production scene must be generated at " + path + ".");
            }

            string[] enabledScenes = EditorBuildSettings.scenes
                .Where(value => value.enabled)
                .Select(value => value.path)
                .ToArray();
            Assert.That(enabledScenes, Is.EqualTo(ExpectedBuildOrder));
        }

        [Test]
        public void BootSceneComposesThePersistentServiceEntryPoint()
        {
            WithScene("Boot", scene =>
            {
                AssertSceneHas<ProductionServicesBootstrap>(scene);
                AssertSceneHas<ProductionBootController>(scene);
                Assert.That(SceneComponents<ProductionPlayerController>(scene), Is.Empty);
            });
        }

        [Test]
        public void CampSceneComposesRollWorkshopSupportCarPlayerAndHud()
        {
            WithScene("Camp", scene =>
            {
                AssertSceneHas<ProductionServicesBootstrap>(scene);
                AssertSceneHas<ProductionPlayerController>(scene);
                AssertSceneHas<MegaBusterWeaponController>(scene);
                AssertSceneHas<RuinCrawlerHudController>(scene);
                AssertSceneHas<RollWorkshopController>(scene);
                AssertSceneHas<RollWorkshopInteraction>(scene);
                AssertSceneHas<RollWorkshopAnimator>(scene);
                AssertSceneHas<RollPresentationAnchor>(scene);
                AssertSceneHas<CampExpeditionInteraction>(scene);
                Assert.That(
                    SceneObjects(scene).Any(value => value.name == "Roll_SupportCar"),
                    Is.True,
                    "Camp must contain Roll's Support Car.");
                Assert.That(
                    SceneObjects(scene).Any(value => value.name == "Roll_Workbench"),
                    Is.True,
                    "Camp must contain Roll's workbench.");
                AssertRollPresentationContract(scene);
                AssertPlayerContract(scene);
            });
        }

        [Test]
        public void ExpeditionSceneOwnsOnlyProceduralRuntimeAdaptersBeforePlay()
        {
            WithScene("Expedition", scene =>
            {
                AssertSceneHas<ProductionServicesBootstrap>(scene);
                AssertSceneHas<ProductionProjectilePool>(scene);
                AssertSceneHas<MegaBusterWeaponController>(scene);
                AssertSceneHas<RuinCrawlerHudController>(scene);
                AssertPlayerContract(scene);
                AssertSceneHas<DungeonSceneBuilderV2>(scene);
                AssertSceneHas<ReaverbotSpawner>(scene);
                AssertSceneHas<BossHuntCoordinator>(scene);
                AssertSceneHas<ExpeditionRuntimeController>(scene);
                Assert.That(
                    SceneComponents<CombatTargetComponent>(scene),
                    Is.Empty,
                    "Expedition YAML must not contain authored enemies; the validated plan owns every spawn.");
            });
        }

        [Test]
        public void TestRangeComposesThreeFixedSharukurusuDiagnostics()
        {
            WithScene("TestRange", scene =>
            {
                AssertSceneHas<ProductionServicesBootstrap>(scene);
                AssertSceneHas<ProductionProjectilePool>(scene);
                AssertSceneHas<MegaBusterWeaponController>(scene);
                AssertSceneHas<RuinCrawlerHudController>(scene);
                AssertPlayerContract(scene);
                CombatTargetComponent[] bodies = SceneComponents<CombatTargetComponent>(scene)
                    .Where(value => value.Kind == RuinCrawler.Core.Foundation.CombatTargetKind.Body)
                    .ToArray();
                Assert.That(bodies, Has.Length.EqualTo(3));
                Assert.That(
                    bodies.Select(value => value.OwnerHealth.Snapshot.Maximum),
                    Is.All.EqualTo((double)SourceGameplayContract.SharukurusuHealth).Within(0.0001d));
            });
        }

        private static void AssertPlayerContract(Scene scene)
        {
            ProductionPlayerController player = SceneComponents<ProductionPlayerController>(scene).Single();
            Assert.That(player.GetComponent<HealthComponent>(), Is.Not.Null);
            Assert.That(
                player.GetComponent<HealthComponent>().Snapshot.Maximum,
                Is.EqualTo(160d).Within(0.0001d));
            Assert.That(player.GetComponent<LockOnController>(), Is.Not.Null);
            Assert.That(player.GetComponent<MegaBusterWeaponController>(), Is.Not.Null);
        }

        private static void AssertRollPresentationContract(Scene scene)
        {
            GameObject roll = scene.GetRootGameObjects().Single(value => value.name == "Roll_Caskett");
            Assert.That(roll.transform.localScale, Is.EqualTo(Vector3.one),
                "Roll's logical interaction root must stay in world units.");

            RollPresentationAnchor anchor = roll.GetComponent<RollPresentationAnchor>();
            Assert.That(anchor, Is.Not.Null);
            Assert.That(anchor.VisualRoot, Is.Not.Null);
            Assert.That(anchor.VisualRoot.parent, Is.SameAs(roll.transform));
            Assert.That(anchor.TryGetVisualBounds(out Bounds bounds), Is.True);
            Assert.That(bounds.size.y, Is.EqualTo(SourceGameplayContract.RollHeight).Within(0.025f));
            Assert.That(bounds.min.y, Is.EqualTo(roll.transform.position.y).Within(0.005f),
                "Roll's rendered feet must be grounded at the Camp floor.");

            CapsuleCollider collider = roll.GetComponent<CapsuleCollider>();
            Assert.That(collider, Is.Not.Null);
            Assert.That(collider.height, Is.EqualTo(SourceGameplayContract.RollHeight).Within(0.0001f));
            Assert.That(collider.radius, Is.EqualTo(SourceGameplayContract.RollRadius).Within(0.0001f));
            Assert.That(collider.bounds.size.y, Is.EqualTo(SourceGameplayContract.RollHeight).Within(0.0001f));

            RollWorkshopInteraction interaction = roll.GetComponent<RollWorkshopInteraction>();
            Assert.That(interaction.Prompt, Is.Not.Null);
            Assert.That(interaction.Prompt.transform.position.y,
                Is.GreaterThan(bounds.max.y),
                "Roll's interaction prompt must sit above the scaled visual instead of inheriting FBX scale.");

            CampExpeditionInteraction departure = SceneComponents<CampExpeditionInteraction>(scene).Single();
            Assert.That(departure.Prompt, Is.Not.Null);
            Assert.That(departure.transform.localScale, Is.EqualTo(Vector3.one));
            Assert.That(
                Vector3.Distance(departure.Prompt.transform.lossyScale, Vector3.one),
                Is.LessThan(0.0001f),
                "Support Car prompts must use an unscaled world-space interaction anchor.");

            GameObject supportCar = scene.GetRootGameObjects().Single(value => value.name == "Roll_SupportCar");
            Assert.That(supportCar.transform.localScale, Is.EqualTo(Vector3.one),
                "The Support Car logical root must stay in world units.");
            Renderer[] carRenderers = supportCar.GetComponentsInChildren<Renderer>(true);
            Assert.That(carRenderers, Is.Not.Empty);
            Bounds renderedCarBounds = carRenderers[0].bounds;
            foreach (Renderer renderer in carRenderers.Skip(1))
            {
                renderedCarBounds.Encapsulate(renderer.bounds);
            }

            BoxCollider carCollider = supportCar.GetComponent<BoxCollider>();
            Assert.That(carCollider, Is.Not.Null);
            Assert.That(Vector3.Distance(carCollider.bounds.center, renderedCarBounds.center), Is.LessThan(0.01f));
            Assert.That(carCollider.bounds.size.x, Is.EqualTo(renderedCarBounds.size.x).Within(0.01f));
            Assert.That(carCollider.bounds.size.y, Is.EqualTo(renderedCarBounds.size.y).Within(0.01f));
            Assert.That(carCollider.bounds.size.z, Is.EqualTo(renderedCarBounds.size.z).Within(0.01f));
        }

        private static void AssertSceneHas<T>(Scene scene) where T : Component
        {
            Assert.That(
                SceneComponents<T>(scene),
                Is.Not.Empty,
                scene.name + " must contain " + typeof(T).Name + ".");
        }

        private static T[] SceneComponents<T>(Scene scene) where T : Component
        {
            return scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<T>(true))
                .ToArray();
        }

        private static IEnumerable<GameObject> SceneObjects(Scene scene)
        {
            return scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                .Select(value => value.gameObject);
        }

        private static void WithScene(string sceneName, Action<Scene> assertion)
        {
            string path = SceneRoot + sceneName + ".unity";
            Scene scene = SceneManager.GetSceneByPath(path);
            bool wasAlreadyLoaded = scene.IsValid() && scene.isLoaded;
            if (!wasAlreadyLoaded)
            {
                scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            }

            try
            {
                Assert.That(scene.IsValid() && scene.isLoaded, Is.True);
                assertion(scene);
            }
            finally
            {
                if (!wasAlreadyLoaded && scene.IsValid() && scene.isLoaded)
                {
                    EditorSceneManager.CloseScene(scene, true);
                }
            }
        }
    }
}
