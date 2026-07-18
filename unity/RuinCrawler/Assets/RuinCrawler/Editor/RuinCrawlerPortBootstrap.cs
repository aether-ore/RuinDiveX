using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RuinCrawler.Port.Editor
{
    public static class RuinCrawlerPortBootstrap
    {
        private const string RootFolder = "Assets/RuinCrawler";
        private const string MaterialFolder = RootFolder + "/Art/Materials";
        private const string PrefabFolder = RootFolder + "/Prefabs";
        private const string SceneFolder = RootFolder + "/Scenes";
        private const string PortingFolder = RootFolder + "/Porting";
        private const string ScenePath = SceneFolder + "/PortingSandbox.unity";
        private const string ManifestPath = PortingFolder + "/PortingManifest.asset";

        private const string SourcePackage = "Packages/com.ruincrawler.source-assets";
        private const string PlayerModelPath = SourcePackage + "/models/Mega Man Volnutt.fbx";
        private const string PlayerTexturePath = SourcePackage + "/models/Mega Man Volnutt.png";
        private const string BusterModelPath = SourcePackage + "/models/Mega Man Volnutt Buster US.obj";
        private const string BusterTexturePath = SourcePackage + "/models/Mega Man Volnutt Buster.png";
        private const string EnemyModelPath = SourcePackage + "/models/reaverbots/Sharukurusu.obj";
        private const string EnemyTexturePath = SourcePackage + "/models/reaverbots/Sharukurusu.png";
        private const string FloorTexturePath = SourcePackage + "/textures/ruins/floor_plain.png";
        private const string WallTexturePath = SourcePackage + "/textures/ruins/wall_macro_industrial.png";

        [MenuItem("Ruin Crawler/Porting/Rebuild First Slice")]
        public static void BuildFirstSlice()
        {
            EnsureFolders();
            ConfigureImportedTextures();
            RuntimeAnimatorController playerAnimatorController = RuinCrawlerPlayerAnimationSetup.BuildPlayerAnimations();

            Material floorMaterial = CreateTexturedMaterial(
                MaterialFolder + "/RuinFloor.mat",
                FloorTexturePath,
                new Color(0.72f, 0.74f, 0.7f));
            Material wallMaterial = CreateTexturedMaterial(
                MaterialFolder + "/RuinWallIndustrial.mat",
                WallTexturePath,
                new Color(0.68f, 0.72f, 0.74f));
            Material playerMaterial = CreateTexturedMaterial(
                MaterialFolder + "/PlayerVolnutt.mat",
                PlayerTexturePath,
                Color.white);
            Material busterMaterial = CreateTexturedMaterial(
                MaterialFolder + "/PlayerMegaBuster.mat",
                BusterTexturePath,
                Color.white);
            Material enemyMaterial = CreateTexturedMaterial(
                MaterialFolder + "/EnemySharukurusu.mat",
                EnemyTexturePath,
                Color.white);
            Material projectileMaterial = CreateProjectileMaterial();

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "PortingSandbox";

            CreateLighting();
            CreateEnvironment(floorMaterial, wallMaterial);
            GameObject player = CreatePlayer(
                playerMaterial,
                busterMaterial,
                projectileMaterial,
                playerAnimatorController);
            CreateEnemy(enemyMaterial);
            CreateCamera(player.transform);
            new GameObject("PrototypeHUD").AddComponent<PrototypeHud>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            EnsureSceneInBuildSettings();
            CreatePortingManifest();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log($"Ruin Crawler Unity port first slice built at {ScenePath}");
        }

        private static void EnsureFolders()
        {
            foreach (string folder in new[] { MaterialFolder, PrefabFolder, SceneFolder, PortingFolder })
            {
                EnsureFolder(folder);
            }
        }

        private static void EnsureFolder(string folder)
        {
            string[] parts = folder.Split('/');
            string current = parts[0];
            for (int index = 1; index < parts.Length; index += 1)
            {
                string next = current + "/" + parts[index];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[index]);
                }
                current = next;
            }
        }

        private static void EnsureSceneInBuildSettings()
        {
            List<EditorBuildSettingsScene> scenes = EditorBuildSettings.scenes.ToList();
            int existingIndex = scenes.FindIndex(scene =>
                string.Equals(scene.path, ScenePath, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0)
            {
                scenes[existingIndex] = new EditorBuildSettingsScene(ScenePath, true);
            }
            else
            {
                scenes.Add(new EditorBuildSettingsScene(ScenePath, true));
            }

            EditorBuildSettings.scenes = scenes.ToArray();
        }

        private static void ConfigureImportedTextures()
        {
            foreach (string path in AssetDatabase.FindAssets("t:Texture2D", new[] { SourcePackage + "/textures", SourcePackage + "/models" })
                         .Select(AssetDatabase.GUIDToAssetPath))
            {
                if (AssetImporter.GetAtPath(path) is not TextureImporter importer)
                {
                    continue;
                }

                string normalizedPath = path.Replace('\\', '/').ToLowerInvariant();
                string lowerName = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
                bool isRuin = normalizedPath.Contains("/textures/ruins/");
                bool isProceduralReaverbot = normalizedPath.Contains("/textures/reaverbots/");
                bool isAuthoredReaverbot = normalizedPath.Contains("/models/reaverbots/");
                bool isReaverbot = isProceduralReaverbot || isAuthoredReaverbot;
                bool isPlayer = string.Equals(path, PlayerTexturePath, StringComparison.OrdinalIgnoreCase)
                                || string.Equals(path, BusterTexturePath, StringComparison.OrdinalIgnoreCase);
                if (!isRuin && !isReaverbot && !isPlayer)
                {
                    continue;
                }

                bool isMask = lowerName.Contains("mask");
                bool isPortrait = lowerName.Contains("portrait");
                FilterMode filterMode = isRuin || isMask || isPlayer ? FilterMode.Trilinear : FilterMode.Point;
                TextureWrapMode wrapMode = isRuin ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
                bool useSrgb = !isMask;
                int anisotropy = isPortrait || isAuthoredReaverbot
                    ? 1
                    : isRuin || isProceduralReaverbot ? 4 : 1;
                bool useMipmaps = !isPortrait;
                bool changed = importer.filterMode != filterMode
                               || importer.wrapMode != wrapMode
                               || importer.textureCompression != TextureImporterCompression.Uncompressed
                               || importer.sRGBTexture != useSrgb
                               || importer.mipmapEnabled != useMipmaps
                               || importer.anisoLevel != anisotropy;
                if (!changed)
                {
                    continue;
                }

                importer.filterMode = filterMode;
                importer.wrapMode = wrapMode;
                importer.textureCompression = TextureImporterCompression.Uncompressed;
                importer.sRGBTexture = useSrgb;
                importer.mipmapEnabled = useMipmaps;
                importer.anisoLevel = anisotropy;
                importer.SaveAndReimport();
            }
        }

        private static Material CreateTexturedMaterial(string assetPath, string texturePath, Color tint)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (texture == null)
            {
                throw new InvalidOperationException($"Required port texture is missing: {texturePath}");
            }

            Material material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            if (material == null)
            {
                Shader shader = Shader.Find("Standard");
                if (shader == null)
                {
                    throw new InvalidOperationException("Built-in Standard shader was not found.");
                }
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, assetPath);
            }

            material.name = Path.GetFileNameWithoutExtension(assetPath);
            material.mainTexture = texture;
            material.color = tint;
            material.SetFloat("_Glossiness", 0.1f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material CreateProjectileMaterial()
        {
            string path = MaterialFolder + "/PrototypeBusterProjectile.mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                Shader shader = Shader.Find("Standard");
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }

            Color cyan = new Color(0.15f, 0.82f, 1f);
            material.color = cyan;
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", cyan * 2.2f);
            material.SetFloat("_Glossiness", 0.15f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void CreateLighting()
        {
            GameObject lightObject = new GameObject("RuinDirectionalLight");
            Light directionalLight = lightObject.AddComponent<Light>();
            directionalLight.type = LightType.Directional;
            directionalLight.intensity = 1.15f;
            directionalLight.color = new Color(0.78f, 0.86f, 1f);
            lightObject.transform.rotation = Quaternion.Euler(48f, -32f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.18f, 0.2f, 0.26f);
            RenderSettings.ambientEquatorColor = new Color(0.09f, 0.11f, 0.14f);
            RenderSettings.ambientGroundColor = new Color(0.035f, 0.04f, 0.05f);
        }

        private static void CreateEnvironment(Material floorMaterial, Material wallMaterial)
        {
            GameObject environment = new GameObject("Environment");
            CreateCube("RuinFloor", environment.transform, new Vector3(0f, -0.1f, 2f), new Vector3(24f, 0.2f, 26f), floorMaterial);
            CreateCube("RearWall", environment.transform, new Vector3(0f, 3f, 13.8f), new Vector3(24f, 6f, 0.4f), wallMaterial);
            CreateCube("LeftWall", environment.transform, new Vector3(-11.8f, 2f, 2f), new Vector3(0.4f, 4f, 26f), wallMaterial);
            CreateCube("RightWall", environment.transform, new Vector3(11.8f, 2f, 2f), new Vector3(0.4f, 4f, 26f), wallMaterial);

            for (int index = -2; index <= 2; index += 1)
            {
                CreateCube(
                    $"RuinPillar_{index + 3:00}",
                    environment.transform,
                    new Vector3(index * 4.2f, 1.25f, 10.6f),
                    new Vector3(0.7f, 2.5f, 0.7f),
                    wallMaterial);
            }
        }

        private static GameObject CreateCube(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name;
            cube.transform.SetParent(parent, false);
            cube.transform.position = position;
            cube.transform.localScale = scale;
            cube.GetComponent<Renderer>().sharedMaterial = material;
            return cube;
        }

        private static GameObject CreatePlayer(
            Material playerMaterial,
            Material busterMaterial,
            Material projectileMaterial,
            RuntimeAnimatorController playerAnimatorController)
        {
            GameObject player = new GameObject("Player");
            player.transform.position = new Vector3(0f, 0f, -5f);
            player.transform.rotation = Quaternion.identity;

            CharacterController controller = player.AddComponent<CharacterController>();
            controller.height = SourceGameplayContract.PlayerHeight;
            controller.radius = SourceGameplayContract.PlayerRadius;
            controller.center = new Vector3(0f, SourceGameplayContract.PlayerHeight * 0.5f, 0f);
            // Initial CharacterController proxy. Unity stepOffset is not a
            // direct equivalent of the Three.js grounded step-down envelope.
            controller.stepOffset = 0.24f;

            GameObject model = LoadAndInstantiateModel(PlayerModelPath, "PlayerVisual_MegaManVolnutt", player.transform);
            NormalizeHeightAndGround(model, SourceGameplayContract.PlayerHeight, player.transform.position.y);
            ApplyMaterial(model, playerMaterial);

            Transform hips = FindDescendant(model.transform, "mixamorig:Hips");
            Transform leftArm = FindDescendant(model.transform, "mixamorig:LeftArm");
            Transform leftForeArm = FindDescendant(model.transform, "mixamorig:LeftForeArm");
            Transform leftHand = FindDescendant(model.transform, "mixamorig:LeftHand");
            if (hips == null || leftArm == null || leftForeArm == null || leftHand == null)
            {
                throw new InvalidOperationException(
                    "The Volnutt model is missing required Mixamo hips/left-arm/left-forearm/left-hand bones.");
            }

            Animator animator = model.GetComponent<Animator>();
            if (animator == null)
            {
                animator = model.AddComponent<Animator>();
            }
            animator.runtimeAnimatorController = playerAnimatorController;
            animator.applyRootMotion = false;
            animator.keepAnimatorStateOnDisable = true;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            PrototypePlayerAnimationDriver animationDriver = model.AddComponent<PrototypePlayerAnimationDriver>();

            PrototypeBusterVisual busterVisual = CreateMegaBusterVisual(
                player,
                model,
                leftForeArm,
                leftHand,
                busterMaterial,
                out Transform muzzle);
            animationDriver.Configure(animator, hips, leftArm, muzzle);

            PrototypePlayerController behavior = player.AddComponent<PrototypePlayerController>();
            behavior.Configure(muzzle, projectileMaterial, animationDriver, busterVisual);

            PrefabUtility.SaveAsPrefabAssetAndConnect(
                player,
                PrefabFolder + "/PlayerPrototype.prefab",
                InteractionMode.AutomatedAction);
            return player;
        }

        private static PrototypeBusterVisual CreateMegaBusterVisual(
            GameObject player,
            GameObject playerModel,
            Transform leftForeArm,
            Transform leftHand,
            Material busterMaterial,
            out Transform muzzle)
        {
            Renderer[] replacedLeftArmRenderers = playerModel
                .GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer.name.IndexOf("HandMesh_L", StringComparison.Ordinal) >= 0)
                .ToArray();
            if (replacedLeftArmRenderers.Length == 0)
            {
                throw new InvalidOperationException(
                    "The Volnutt model is missing its independently replaceable HandMesh_L renderer.");
            }

            GameObject mount = new GameObject("MegaBuster_Left");
            mount.transform.SetParent(leftForeArm, false);
            Vector3 wristLocalPosition = leftForeArm.InverseTransformPoint(leftHand.position);
            if (wristLocalPosition.sqrMagnitude <= 0.00000001f)
            {
                throw new InvalidOperationException("The Volnutt left elbow and wrist occupy the same position.");
            }
            mount.transform.localRotation = Quaternion.FromToRotation(
                Vector3.forward,
                wristLocalPosition.normalized);

            GameObject busterModel = LoadAndInstantiateModel(
                BusterModelPath,
                "MegaBusterVisual",
                mount.transform);
            ApplyMaterial(busterModel, busterMaterial);
            Bounds sourceBounds = CalculateMeshBoundsInRoot(busterModel);
            float sourceLength = Mathf.Max(
                0.0001f,
                Mathf.Max(sourceBounds.size.x, Mathf.Max(sourceBounds.size.y, sourceBounds.size.z)));
            float busterScale = wristLocalPosition.magnitude * 1.18f / sourceLength;
            busterModel.transform.localScale = Vector3.one * busterScale;
            busterModel.transform.localPosition = new Vector3(
                -sourceBounds.center.x * busterScale,
                -sourceBounds.center.y * busterScale,
                -sourceBounds.min.z * busterScale);

            muzzle = new GameObject("BusterMuzzle").transform;
            muzzle.SetParent(mount.transform, false);
            muzzle.localPosition = Vector3.forward * (sourceBounds.size.z * busterScale * 1.12f);

            PrototypeBusterVisual visual = player.AddComponent<PrototypeBusterVisual>();
            visual.Configure(mount, replacedLeftArmRenderers);
            return visual;
        }

        private static Bounds CalculateMeshBoundsInRoot(GameObject root)
        {
            MeshFilter[] meshFilters = root.GetComponentsInChildren<MeshFilter>(true);
            if (meshFilters.Length == 0)
            {
                throw new InvalidOperationException($"Imported model has no mesh filters: {root.name}");
            }

            Bounds combined = default;
            bool initialized = false;
            foreach (MeshFilter meshFilter in meshFilters)
            {
                if (meshFilter.sharedMesh == null)
                {
                    continue;
                }

                Bounds meshBounds = meshFilter.sharedMesh.bounds;
                for (int x = -1; x <= 1; x += 2)
                {
                    for (int y = -1; y <= 1; y += 2)
                    {
                        for (int z = -1; z <= 1; z += 2)
                        {
                            Vector3 corner = meshBounds.center + Vector3.Scale(
                                meshBounds.extents,
                                new Vector3(x, y, z));
                            Vector3 rootPoint = root.transform.InverseTransformPoint(
                                meshFilter.transform.TransformPoint(corner));
                            if (!initialized)
                            {
                                combined = new Bounds(rootPoint, Vector3.zero);
                                initialized = true;
                            }
                            else
                            {
                                combined.Encapsulate(rootPoint);
                            }
                        }
                    }
                }
            }

            if (!initialized)
            {
                throw new InvalidOperationException($"Imported model has no usable meshes: {root.name}");
            }
            return combined;
        }

        private static GameObject CreateEnemy(Material enemyMaterial)
        {
            GameObject enemy = new GameObject("Enemy_Sharukurusu_Target");
            enemy.transform.position = new Vector3(0f, 0f, 2.7f);
            enemy.transform.rotation = Quaternion.Euler(0f, 180f, 0f);

            GameObject model = LoadAndInstantiateModel(EnemyModelPath, "SharukurusuVisual", enemy.transform);
            NormalizeHeightAndGround(model, SourceGameplayContract.SharukurusuHeight, enemy.transform.position.y);
            ApplyMaterial(model, enemyMaterial);

            CapsuleCollider collider = enemy.AddComponent<CapsuleCollider>();
            collider.height = SourceGameplayContract.SharukurusuHeight;
            collider.radius = SourceGameplayContract.SharukurusuRadius;
            collider.center = new Vector3(0f, SourceGameplayContract.SharukurusuHeight * 0.5f, 0f);
            PrototypeDamageTarget damageTarget = enemy.AddComponent<PrototypeDamageTarget>();
            damageTarget.Configure(SourceGameplayContract.SharukurusuHealth);

            PrefabUtility.SaveAsPrefabAssetAndConnect(
                enemy,
                PrefabFolder + "/SharukurusuTarget.prefab",
                InteractionMode.AutomatedAction);
            return enemy;
        }

        private static GameObject LoadAndInstantiateModel(string path, string name, Transform parent)
        {
            GameObject asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (asset == null)
            {
                throw new InvalidOperationException($"Required port model is missing or failed to import: {path}");
            }

            GameObject instance = PrefabUtility.InstantiatePrefab(asset) as GameObject;
            if (instance == null)
            {
                instance = UnityEngine.Object.Instantiate(asset);
            }
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            return instance;
        }

        private static void NormalizeHeightAndGround(GameObject instance, float targetHeight, float groundY)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
            {
                throw new InvalidOperationException($"Imported model has no renderers: {instance.name}");
            }

            Bounds bounds = renderers[0].bounds;
            foreach (Renderer targetRenderer in renderers.Skip(1))
            {
                bounds.Encapsulate(targetRenderer.bounds);
            }

            if (bounds.size.y > 0.0001f)
            {
                instance.transform.localScale *= targetHeight / bounds.size.y;
            }

            bounds = instance.GetComponentsInChildren<Renderer>(true)[0].bounds;
            foreach (Renderer targetRenderer in instance.GetComponentsInChildren<Renderer>(true).Skip(1))
            {
                bounds.Encapsulate(targetRenderer.bounds);
            }
            instance.transform.position += Vector3.up * (groundY - bounds.min.y);
        }

        private static void ApplyMaterial(GameObject root, Material material)
        {
            foreach (Renderer targetRenderer in root.GetComponentsInChildren<Renderer>(true))
            {
                Material[] replacements = targetRenderer.sharedMaterials
                    .Select(_ => material)
                    .ToArray();
                targetRenderer.sharedMaterials = replacements.Length > 0 ? replacements : new[] { material };
            }
        }

        private static Transform FindDescendant(Transform root, string targetName)
        {
            return root.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(candidate => candidate.name == targetName);
        }

        private static void CreateCamera(Transform player)
        {
            GameObject cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = SourceGameplayContract.CameraFieldOfView;
            camera.nearClipPlane = SourceGameplayContract.CameraNearClip;
            camera.farClipPlane = SourceGameplayContract.CameraFarClip;
            camera.backgroundColor = new Color(0.025f, 0.035f, 0.055f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.transform.position = player.position + new Vector3(
                0f,
                SourceGameplayContract.CameraHeight,
                -SourceGameplayContract.CameraDistance);
            PrototypeFollowCamera follow = cameraObject.AddComponent<PrototypeFollowCamera>();
            follow.Configure(player);
            cameraObject.transform.LookAt(
                player.position
                + player.forward * SourceGameplayContract.CameraLookAhead
                + Vector3.up * SourceGameplayContract.CameraLookHeight);
        }

        private static void CreatePortingManifest()
        {
            PortingManifest manifest = AssetDatabase.LoadAssetAtPath<PortingManifest>(ManifestPath);
            if (manifest == null)
            {
                manifest = ScriptableObject.CreateInstance<PortingManifest>();
                AssetDatabase.CreateAsset(manifest, ManifestPath);
            }

            manifest.Replace(
                "threejs-working-tree-2026-07-17",
                DateTime.UtcNow.ToString("O"),
                new[]
                {
                    new PortedAssetEntry("player.volnutt.prototype", "character", "assets/models/Mega Man Volnutt.fbx", PlayerModelPath, "animated-graybox", "Imported, height-normalized, and driven by exact-skeleton Generic clips. Rights review required before distribution."),
                    new PortedAssetEntry("player.volnutt.animations.core", "animation-set", "assets/models/animations", RuinCrawlerPlayerAnimationSetup.ControllerPath, "integrated", "Combat-ready Action Idle hands off to foot-planted Breathing Idle after 20 seconds; walk, jog, sprint, jump rise/fall/land, and a masked source-authored left-Buster aim overlay are integrated. CharacterController owns root motion."),
                    new PortedAssetEntry("player.volnutt.mega_buster", "equipment-model", "assets/models/Mega Man Volnutt Buster US.obj", BusterModelPath, "integrated", "Invariant Mega Buster replaces HandMesh_L, follows the animated left forearm, and owns the projectile muzzle. Rights review required before distribution."),
                    new PortedAssetEntry("enemy.sharukurusu.target", "enemy", "assets/models/reaverbots/Sharukurusu.obj", EnemyModelPath, "graybox", "Imported as a static target prefab; production Reaverbot behavior is not yet ported."),
                    new PortedAssetEntry("environment.ruins.floor_plain", "texture", "assets/textures/ruins/floor_plain.png", FloorTexturePath, "integrated", "Point-filtered material used in PortingSandbox."),
                    new PortedAssetEntry("environment.ruins.wall_industrial", "texture", "assets/textures/ruins/wall_macro_industrial.png", WallTexturePath, "integrated", "Point-filtered material used in PortingSandbox."),
                    new PortedAssetEntry("logic.seeded_random", "deterministic-kernel", "src/reaverbots/SeededRandom.js", "Assets/RuinCrawler/Runtime/Determinism/SeededRandom.cs", "parity-tested", "String-seed FNV/mulberry32 behavior ported bit-for-bit.")
                });
            EditorUtility.SetDirty(manifest);
        }
    }
}
