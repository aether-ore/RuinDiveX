using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Port.Editor;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.BossHunts;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Expedition;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using RuinCrawler.Runtime.Reaverbots;
using RuinCrawler.Runtime.Roll;
using RuinCrawler.UI.Hud;
using RuinCrawler.UI.Pause;
using RuinCrawler.UI.Workshop;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RuinCrawler.Editor
{
    public static class RuinCrawlerProductionBootstrap
    {
        private const string Root = "Assets/RuinCrawler";
        private const string Scenes = Root + "/Scenes";
        private const string Materials = Root + "/Art/Materials";
        private const string Animation = Root + "/Animation";
        private const string Source = "Packages/com.ruincrawler.source-assets";
        private const string ContractPath = Source + "/contracts/ruin-crawler-contracts.v1.json";
        private const string InputPath = Root + "/Input/RuinCrawlerInput.inputactions";
        private const string PlayerPrefabPath = Root + "/Prefabs/PlayerPrototype.prefab";
        private const string EnemyPrefabPath = Root + "/Prefabs/SharukurusuTarget.prefab";
        private const string RollModelPath = Source + "/models/npcs/roll/roll-x-dive.fbx";
        private const string RollTexturePath = Source + "/models/npcs/roll/roll-x-dive.png";
        private const string SupportCarPath = Source + "/models/props/support-car/support-car.obj";
        private const string SupportCarTexturePath = Source + "/models/props/support-car/support-car.png";
        private const string WorkbenchTexturePath = Source + "/textures/camp/roll-workbench-albedo.png";

        private static readonly string[] RollAnimationNames =
        {
            "Idle", "Waving", "Talking", "Explaining", "Thinking", "Happy", "Thankful", "Bashful"
        };

        private static readonly string[] RollAnimationFiles =
        {
            "idle", "waving", "talking", "explaining", "thinking", "happy", "thankful", "bashful"
        };

        [MenuItem("Ruin Crawler/Porting/Rebuild Production Scenes")]
        public static void RebuildProductionScenes()
        {
            // The sandbox remains the disposable source-asset regression scene;
            // rebuilding it also guarantees the player/enemy prefabs and shared
            // semantic materials exist before production composition.
            RuinCrawlerPortBootstrap.BuildFirstSlice();
            EnsureFolder(Scenes);
            EnsureFolder(Materials);
            EnsureFolder(Animation);

            TextAsset contract = RequireAsset<TextAsset>(ContractPath);
            InputActionAsset input = RequireAsset<InputActionAsset>(InputPath);
            RuntimeAnimatorController rollController = BuildRollAnimator();
            Material floor = RequireAsset<Material>(Materials + "/RuinFloor.mat");
            Material wall = RequireAsset<Material>(Materials + "/RuinWallIndustrial.mat");
            Material projectile = RequireAsset<Material>(Materials + "/PrototypeBusterProjectile.mat");
            Material enemy = RequireAsset<Material>(Materials + "/EnemySharukurusu.mat");
            Material roll = CreateMaterial(Materials + "/RollCaskett.mat", RollTexturePath, Color.white);
            Material supportCar = CreateMaterial(Materials + "/SupportCar.mat", SupportCarTexturePath, Color.white);
            Material workbench = CreateMaterial(Materials + "/RollWorkbench.mat", WorkbenchTexturePath, Color.white);
            Material weakPoint = CreateEmissiveMaterial(Materials + "/WeakPointRuby.mat", new Color(0.95f, 0.04f, 0.08f));

            CreateBootScene(contract);
            CreateCampScene(contract, input, rollController, floor, wall, projectile, roll, supportCar, workbench);
            CreateExpeditionScene(contract, input, floor, wall, projectile, enemy, weakPoint, false);
            CreateTestRangeScene(contract, input, floor, wall, projectile, enemy, weakPoint);
            ConfigurePhysicsMatrix();
            ConfigureBuildSettings();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Ruin Crawler production scenes rebuilt: Boot, Camp, Expedition, TestRange.");
        }

        private static void CreateBootScene(TextAsset contract)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Boot";
            CreateServicesBootstrap(contract);
            new GameObject("BootSceneController").AddComponent<ProductionBootController>();
            EditorSceneManager.SaveScene(scene, Scenes + "/Boot.unity");
        }

        private static void CreateCampScene(
            TextAsset contract,
            InputActionAsset input,
            RuntimeAnimatorController rollController,
            Material floor,
            Material wall,
            Material projectile,
            Material rollMaterial,
            Material supportCarMaterial,
            Material workbenchMaterial)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Camp";
            CreateServicesBootstrap(contract);
            CreateLighting(true);
            CreateCampEnvironment(floor, wall, workbenchMaterial);
            ProductionPlayerController player = CreateProductionPlayer(input, projectile, new Vector3(-3f, 0f, -5f), out Camera camera);
            GameObject roll = CreateRoll(rollController, rollMaterial, new Vector3(2.2f, 0f, 1.6f), out RollWorkshopAnimator rollAnimator);
            GameObject supportCar = CreateSupportCar(supportCarMaterial, new Vector3(6.2f, 0f, 4f));

            GameObject workshopObject = new GameObject("RollWorkshopUI");
            workshopObject.AddComponent<UIDocument>();
            RollWorkshopController workshop = workshopObject.AddComponent<RollWorkshopController>();
            workshop.Configure(null, null, player, true, rollAnimator, null);

            TextMesh prompt = CreateWorldPrompt(
                roll.transform,
                camera,
                new Vector3(0f, SourceGameplayContract.RollHeight + 0.34f, 0f),
                "F / X  TALK TO ROLL");
            RollWorkshopInteraction interaction = roll.AddComponent<RollWorkshopInteraction>();
            interaction.Configure(workshop, player, input, prompt);
            CreateSupportCarDeparture(supportCar, player, input, camera);
            EditorSceneManager.SaveScene(scene, Scenes + "/Camp.unity");
        }

        private static void CreateExpeditionScene(
            TextAsset contract,
            InputActionAsset input,
            Material floor,
            Material wall,
            Material projectile,
            Material enemyMaterial,
            Material weakPointMaterial,
            bool testRange)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Expedition";
            CreateServicesBootstrap(contract);
            CreateLighting(false);
            ProductionPlayerController player = CreateProductionPlayer(
                input,
                projectile,
                new Vector3(0f, 0f, -10f),
                out _);
            GameObject runtimeObject = new GameObject("ExpeditionRuntime");
            runtimeObject.AddComponent<DungeonSceneBuilderV2>();
            ReaverbotSpawner spawner = runtimeObject.AddComponent<ReaverbotSpawner>();
            BossHuntCoordinator bossHunts = runtimeObject.AddComponent<BossHuntCoordinator>();
            bossHunts.Configure(contract, spawner, player.transform);
            ExpeditionRuntimeController expedition = runtimeObject.AddComponent<ExpeditionRuntimeController>();
            expedition.Configure(contract, spawner, player.transform, generateAtStart: true);
            EditorSceneManager.SaveScene(scene, Scenes + "/Expedition.unity");
        }

        private static void CreateTestRangeScene(
            TextAsset contract,
            InputActionAsset input,
            Material floor,
            Material wall,
            Material projectile,
            Material enemyMaterial,
            Material weakPointMaterial)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "TestRange";
            CreateServicesBootstrap(contract);
            CreateLighting(true);
            CreateRuinArena(floor, wall, 36f, 32f);
            CreateProductionPlayer(input, projectile, new Vector3(0f, 0f, -9f), out _);
            for (int index = 0; index < 3; index += 1)
            {
                CreateCombatTarget(
                    enemyMaterial,
                    weakPointMaterial,
                    new Vector3((index - 1) * 5f, 0f, 5f + index * 1.5f),
                    "range.sharukurusu." + (index + 1).ToString("000"),
                    "Sharukurusu Test " + (index + 1));
            }
            EditorSceneManager.SaveScene(scene, Scenes + "/TestRange.unity");
        }

        private static void CreateServicesBootstrap(TextAsset contract)
        {
            GameObject bootstrap = new GameObject("ProductionServicesBootstrap");
            bootstrap.AddComponent<ProductionServicesBootstrap>().Configure(contract);
        }

        private static ProductionPlayerController CreateProductionPlayer(
            InputActionAsset input,
            Material projectileMaterial,
            Vector3 position,
            out Camera camera)
        {
            GameObject prefab = RequireAsset<GameObject>(PlayerPrefabPath);
            GameObject playerObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            playerObject.name = "Player_MegaManVolnutt";
            playerObject.transform.SetPositionAndRotation(position, Quaternion.identity);
            SetLayerRecursively(playerObject, RequireLayer("Player"));

            PrototypePlayerController prototype = playerObject.GetComponent<PrototypePlayerController>();
            if (prototype != null) UnityEngine.Object.DestroyImmediate(prototype);
            HealthComponent health = GetOrAddComponent<HealthComponent>(playerObject);
            health.Configure(160f);
            GetOrAddComponent<PlayerEnvironmentalProtection>(playerObject);
            LockOnController lockOn = GetOrAddComponent<LockOnController>(playerObject);

            GameObject poolObject = new GameObject("PlayerProjectilePool");
            ProductionProjectilePool pool = poolObject.AddComponent<ProductionProjectilePool>();
            pool.Configure(
                projectileMaterial,
                LayerMask.GetMask("Enemy", "Targetable", "WorldGeometry", "Hazard"),
                24);
            MegaBusterWeaponController weapon = GetOrAddComponent<MegaBusterWeaponController>(playerObject);
            weapon.Configure(pool);

            PrototypePlayerAnimationDriver animationDriver = playerObject.GetComponentInChildren<PrototypePlayerAnimationDriver>(true);
            PrototypeBusterVisual buster = playerObject.GetComponent<PrototypeBusterVisual>();
            Transform muzzle = animationDriver != null ? animationDriver.BusterMuzzle : playerObject.transform;

            GameObject cameraObject = new GameObject("MainCamera");
            cameraObject.tag = "MainCamera";
            camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = 0.08f;
            camera.farClipPlane = 180f;
            camera.fieldOfView = 48f;
            cameraObject.AddComponent<AudioListener>();
            ProductionFollowCamera follow = cameraObject.AddComponent<ProductionFollowCamera>();
            lockOn.Configure(input, camera);
            follow.Configure(playerObject.transform, lockOn, input);

            ProductionPlayerController player = GetOrAddComponent<ProductionPlayerController>(playerObject);
            player.Configure(input, camera, muzzle, weapon, lockOn, health, animationDriver, buster);

            GameObject hudObject = new GameObject("ProductionHUD");
            hudObject.AddComponent<UIDocument>();
            RuinCrawlerHudController hud = hudObject.AddComponent<RuinCrawlerHudController>();
            hud.Configure(player, camera);

            GameObject pauseObject = new GameObject("ProductionPauseStatusUI");
            pauseObject.AddComponent<UIDocument>();
            PauseStatusMenuController pause = pauseObject.AddComponent<PauseStatusMenuController>();
            pause.Configure(input, player);
            return player;
        }

        private static GameObject CreateCombatTarget(
            Material enemyMaterial,
            Material weakPointMaterial,
            Vector3 position,
            string stableId,
            string displayName)
        {
            GameObject prefab = RequireAsset<GameObject>(EnemyPrefabPath);
            GameObject target = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            target.name = displayName.Replace(' ', '_');
            target.transform.position = position;
            ApplyMaterial(target, enemyMaterial);
            SetLayerRecursively(target, RequireLayer("Enemy"));
            PrototypeDamageTarget oldTarget = target.GetComponent<PrototypeDamageTarget>();
            if (oldTarget != null) UnityEngine.Object.DestroyImmediate(oldTarget);

            CapsuleCollider bodyCollider = GetOrAddComponent<CapsuleCollider>(target);
            bodyCollider.radius = 0.72f;
            bodyCollider.height = 1.8f;
            bodyCollider.center = new Vector3(0f, 0.9f, 0f);
            HealthComponent health = GetOrAddComponent<HealthComponent>(target);
            health.Configure(SourceGameplayContract.SharukurusuHealth, 0f, true);

            Transform bodyAim = new GameObject("Aim_Body").transform;
            bodyAim.SetParent(target.transform, false);
            bodyAim.localPosition = new Vector3(0f, 1.12f, 0f);
            CombatTargetComponent body = GetOrAddComponent<CombatTargetComponent>(target);
            body.Configure(stableId + ".body", stableId + ".body", displayName, health, bodyAim);

            GameObject weakPoint = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            weakPoint.name = "WeakPoint_RubyOptic";
            weakPoint.transform.SetParent(target.transform, false);
            weakPoint.transform.localPosition = new Vector3(0f, 1.24f, -0.42f);
            weakPoint.transform.localScale = Vector3.one * 0.26f;
            weakPoint.GetComponent<Renderer>().sharedMaterial = weakPointMaterial;
            weakPoint.layer = RequireLayer("Targetable");
            CombatTargetComponent weak = weakPoint.AddComponent<CombatTargetComponent>();
            weak.Configure(
                stableId + ".weak.ruby-optic",
                stableId + ".body",
                displayName,
                health,
                weakPoint.transform,
                RuinCrawler.Core.Foundation.CombatTargetKind.WeakPoint,
                "Ruby Optic",
                0.34f,
                true,
                stableId + ".body",
                1.5f);
            return target;
        }

        private static GameObject CreateRoll(
            RuntimeAnimatorController controller,
            Material material,
            Vector3 position,
            out RollWorkshopAnimator contextualAnimator)
        {
            GameObject source = RequireAsset<GameObject>(RollModelPath);
            GameObject roll = new GameObject("Roll_Caskett");
            roll.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, 205f, 0f));

            GameObject visual = (GameObject)PrefabUtility.InstantiatePrefab(source);
            visual.name = "Roll_Visual";
            visual.transform.SetParent(roll.transform, false);
            visual.transform.localPosition = Vector3.zero;
            visual.transform.localRotation = Quaternion.identity;
            visual.transform.localScale = Vector3.one;
            NormalizeHeightAndGroundVisual(visual, SourceGameplayContract.RollHeight, position.y);

            ApplyMaterial(visual, material);
            SetLayerRecursively(roll, RequireLayer("Interactable"));
            Animator animator = GetOrAddComponent<Animator>(visual);
            animator.runtimeAnimatorController = controller;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            contextualAnimator = roll.AddComponent<RollWorkshopAnimator>();
            contextualAnimator.Configure(animator);
            RollPresentationAnchor presentation = roll.AddComponent<RollPresentationAnchor>();
            presentation.Configure(visual.transform);
            CapsuleCollider collider = GetOrAddComponent<CapsuleCollider>(roll);
            collider.height = SourceGameplayContract.RollHeight;
            collider.radius = SourceGameplayContract.RollRadius;
            collider.center = new Vector3(0f, SourceGameplayContract.RollHeight * 0.5f, 0f);
            return roll;
        }

        private static GameObject CreateSupportCar(Material material, Vector3 position)
        {
            GameObject source = RequireAsset<GameObject>(SupportCarPath);
            GameObject car = new GameObject("Roll_SupportCar");
            car.transform.position = position;

            GameObject visual = (GameObject)PrefabUtility.InstantiatePrefab(source);
            visual.name = "SupportCar_Visual";
            visual.transform.SetParent(car.transform, false);
            visual.transform.localPosition = Vector3.zero;
            visual.transform.localRotation = Quaternion.identity;
            visual.transform.localScale = Vector3.one;
            NormalizeLongestAxisAndGroundVisual(visual, 4.8f, position.y);
            ApplyMaterial(visual, material);

            BoxCollider collider = GetOrAddComponent<BoxCollider>(car);
            Bounds bounds = CalculateBounds(visual);
            collider.center = car.transform.InverseTransformPoint(bounds.center);
            collider.size = bounds.size;
            car.transform.rotation = Quaternion.Euler(0f, 145f, 0f);
            SetLayerRecursively(car, RequireLayer("WorldGeometry"));
            return car;
        }

        private static void CreateSupportCarDeparture(
            GameObject supportCar,
            ProductionPlayerController player,
            InputActionAsset input,
            Camera camera)
        {
            Bounds carBounds = CalculateBounds(supportCar);
            GameObject departure = new GameObject("SupportCar_DungeonDeparture");
            departure.transform.position = new Vector3(
                carBounds.max.x + 0.65f,
                carBounds.min.y,
                carBounds.center.z);
            TextMesh prompt = CreateWorldPrompt(
                departure.transform,
                camera,
                new Vector3(0f, 2.15f, 0f),
                "F / X  ENTER DUNGEON");
            prompt.gameObject.name = "SupportCarDeparturePrompt";
            CampExpeditionInteraction interaction = departure.AddComponent<CampExpeditionInteraction>();
            interaction.Configure(player, input, prompt);
        }

        private static TextMesh CreateWorldPrompt(
            Transform parent,
            Camera camera,
            Vector3 localPosition,
            string text)
        {
            GameObject promptObject = new GameObject("RollInteractionPrompt");
            promptObject.transform.SetParent(parent, false);
            promptObject.transform.localPosition = localPosition;
            if (camera != null)
            {
                Vector3 facing = Vector3.ProjectOnPlane(
                    camera.transform.position - promptObject.transform.position,
                    Vector3.up);
                if (facing.sqrMagnitude > 0.0001f)
                {
                    // TextMesh renders its readable face toward local -Z.
                    promptObject.transform.rotation = Quaternion.LookRotation(-facing, Vector3.up);
                }
            }
            TextMesh prompt = promptObject.AddComponent<TextMesh>();
            prompt.text = text;
            prompt.characterSize = 0.08f;
            prompt.fontSize = 48;
            prompt.anchor = TextAnchor.MiddleCenter;
            prompt.alignment = TextAlignment.Center;
            prompt.color = new Color(0.35f, 0.95f, 1f);
            promptObject.SetActive(false);
            return prompt;
        }

        private static RuntimeAnimatorController BuildRollAnimator()
        {
            ConfigureModelImporter(RollModelPath, loop: true);
            var clips = new List<AnimationClip>();
            for (int index = 0; index < RollAnimationFiles.Length; index += 1)
            {
                string path = Source + "/models/npcs/roll/animations/" + RollAnimationFiles[index] + ".fbx";
                ConfigureModelImporter(path, string.Equals(RollAnimationNames[index], "Idle", StringComparison.Ordinal));
                AnimationClip clip = AssetDatabase.LoadAllAssetsAtPath(path)
                    .OfType<AnimationClip>()
                    .FirstOrDefault(value => !value.name.StartsWith("__preview__", StringComparison.Ordinal));
                if (clip == null)
                    throw new InvalidOperationException("Roll animation clip failed to import: " + path);
                clips.Add(clip);
            }

            string pathController = Animation + "/RollWorkshop.controller";
            AnimatorController controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(pathController);
            if (controller == null)
                controller = AnimatorController.CreateAnimatorControllerAtPath(pathController);
            AnimatorStateMachine machine = controller.layers[0].stateMachine;
            foreach (ChildAnimatorState child in machine.states.ToArray())
                machine.RemoveState(child.state);
            for (int index = 0; index < clips.Count; index += 1)
            {
                AnimatorState state = machine.AddState(RollAnimationNames[index]);
                state.motion = clips[index];
                if (index == 0) machine.defaultState = state;
            }
            EditorUtility.SetDirty(controller);
            return controller;
        }

        private static void ConfigureModelImporter(string path, bool loop)
        {
            if (!(AssetImporter.GetAtPath(path) is ModelImporter importer))
                throw new InvalidOperationException("Model importer not found: " + path);
            ModelImporterClipAnimation[] source = importer.defaultClipAnimations;
            if (source.Length > 0)
            {
                ModelImporterClipAnimation clip = source[0];
                clip.loopTime = loop;
                clip.loopPose = loop;
                clip.lockRootPositionXZ = true;
                clip.lockRootHeightY = true;
                clip.lockRootRotation = true;
                importer.clipAnimations = new[] { clip };
            }
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
            importer.importAnimation = true;
            importer.preserveHierarchy = true;
            importer.importNormals = ModelImporterNormals.Calculate;
            importer.importTangents = ModelImporterTangents.CalculateMikk;
            importer.SaveAndReimport();
        }

        private static void CreateCampEnvironment(Material floor, Material wall, Material workbench)
        {
            CreateRuinArena(floor, wall, 26f, 28f);
            GameObject bench = new GameObject("Roll_Workbench");
            CreateCube("WorkbenchTop", bench.transform, new Vector3(2.2f, 0.85f, 3.1f), new Vector3(3.3f, 0.18f, 1.2f), workbench);
            CreateCube("WorkbenchLegL", bench.transform, new Vector3(1f, 0.4f, 3.1f), new Vector3(0.18f, 0.8f, 0.8f), wall);
            CreateCube("WorkbenchLegR", bench.transform, new Vector3(3.4f, 0.4f, 3.1f), new Vector3(0.18f, 0.8f, 0.8f), wall);
        }

        private static void CreateRuinArena(Material floor, Material wall, float width, float depth)
        {
            GameObject environment = new GameObject("Environment");
            CreateCube("Floor", environment.transform, new Vector3(0f, -0.1f, 2f), new Vector3(width, 0.2f, depth), floor);
            CreateCube("RearWall", environment.transform, new Vector3(0f, 2.8f, 2f + depth * 0.5f), new Vector3(width, 5.6f, 0.4f), wall);
            CreateCube("LeftWall", environment.transform, new Vector3(-width * 0.5f, 2f, 2f), new Vector3(0.4f, 4f, depth), wall);
            CreateCube("RightWall", environment.transform, new Vector3(width * 0.5f, 2f, 2f), new Vector3(0.4f, 4f, depth), wall);
        }

        private static GameObject CreateCube(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name;
            cube.transform.SetParent(parent, false);
            cube.transform.position = position;
            cube.transform.localScale = scale;
            cube.GetComponent<Renderer>().sharedMaterial = material;
            SetLayerRecursively(cube, RequireLayer("WorldGeometry"));
            return cube;
        }

        private static void CreateLighting(bool bright)
        {
            GameObject lightObject = new GameObject("DirectionalLight");
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = bright ? 1.15f : 0.68f;
            light.color = bright ? new Color(0.86f, 0.91f, 1f) : new Color(0.48f, 0.62f, 0.8f);
            lightObject.transform.rotation = Quaternion.Euler(48f, -32f, 0f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = bright ? new Color(0.18f, 0.22f, 0.28f) : new Color(0.045f, 0.065f, 0.1f);
            RenderSettings.ambientEquatorColor = bright ? new Color(0.1f, 0.12f, 0.15f) : new Color(0.025f, 0.035f, 0.055f);
            RenderSettings.ambientGroundColor = new Color(0.015f, 0.02f, 0.025f);
        }

        private static Material CreateMaterial(string assetPath, string texturePath, Color color)
        {
            Texture2D texture = RequireAsset<Texture2D>(texturePath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material, assetPath);
            }
            material.mainTexture = texture;
            material.color = color;
            material.SetFloat("_Glossiness", 0.08f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material CreateEmissiveMaterial(string assetPath, Color color)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material, assetPath);
            }
            material.color = color;
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", color * 2.4f);
            material.SetFloat("_Glossiness", 0.18f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void ApplyMaterial(GameObject root, Material material)
        {
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                Material[] shared = renderer.sharedMaterials;
                for (int index = 0; index < shared.Length; index += 1) shared[index] = material;
                renderer.sharedMaterials = shared.Length == 0 ? new[] { material } : shared;
            }
        }

        private static void NormalizeHeightAndGroundVisual(GameObject visual, float height, float groundY)
        {
            Bounds bounds = CalculateBounds(visual);
            float scale = height / Mathf.Max(0.001f, bounds.size.y);
            visual.transform.localScale *= scale;
            bounds = CalculateBounds(visual);
            visual.transform.position += Vector3.up * (groundY - bounds.min.y);
        }

        private static void NormalizeLongestAxisAndGroundVisual(GameObject visual, float size, float groundY)
        {
            Bounds bounds = CalculateBounds(visual);
            float longest = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
            visual.transform.localScale *= size / Mathf.Max(0.001f, longest);
            bounds = CalculateBounds(visual);
            visual.transform.position += Vector3.up * (groundY - bounds.min.y);
        }

        private static Bounds CalculateBounds(GameObject root)
        {
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return new Bounds(root.transform.position, Vector3.one);
            Bounds bounds = renderers[0].bounds;
            for (int index = 1; index < renderers.Length; index += 1) bounds.Encapsulate(renderers[index].bounds);
            return bounds;
        }

        private static void ConfigurePhysicsMatrix()
        {
            int player = RequireLayer("Player");
            int enemy = RequireLayer("Enemy");
            int playerProjectile = RequireLayer("PlayerProjectile");
            int enemyProjectile = RequireLayer("EnemyProjectile");
            Physics.IgnoreLayerCollision(player, playerProjectile, true);
            Physics.IgnoreLayerCollision(enemy, enemyProjectile, true);
            Physics.IgnoreLayerCollision(playerProjectile, playerProjectile, true);
            Physics.IgnoreLayerCollision(enemyProjectile, enemyProjectile, true);
            Physics.IgnoreLayerCollision(playerProjectile, enemyProjectile, true);
        }

        private static void ConfigureBuildSettings()
        {
            string[] paths =
            {
                Scenes + "/Boot.unity",
                Scenes + "/Camp.unity",
                Scenes + "/Expedition.unity",
                Scenes + "/TestRange.unity",
                Scenes + "/PortingSandbox.unity"
            };
            EditorBuildSettings.scenes = paths
                .Select(path => new EditorBuildSettingsScene(path, true))
                .ToArray();
        }

        private static int RequireLayer(string name)
        {
            int layer = LayerMask.NameToLayer(name);
            if (layer < 0) throw new InvalidOperationException("Required physics layer is missing: " + name);
            return layer;
        }

        private static void SetLayerRecursively(GameObject root, int layer)
        {
            foreach (Transform child in root.GetComponentsInChildren<Transform>(true)) child.gameObject.layer = layer;
        }

        private static T RequireAsset<T>(string path) where T : UnityEngine.Object
        {
            T asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset == null) throw new InvalidOperationException("Required Unity asset is missing: " + path);
            return asset;
        }

        private static T GetOrAddComponent<T>(GameObject target) where T : Component
        {
            T component = target.GetComponent<T>();
            return component == null ? target.AddComponent<T>() : component;
        }

        private static void EnsureFolder(string folder)
        {
            string[] parts = folder.Split('/');
            string current = parts[0];
            for (int index = 1; index < parts.Length; index += 1)
            {
                string next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }
    }
}
