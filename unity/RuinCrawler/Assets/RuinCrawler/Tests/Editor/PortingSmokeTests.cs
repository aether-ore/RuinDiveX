using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace RuinCrawler.Port.Tests
{
    public sealed class PortingSmokeTests
    {
        [TestCase("Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt.fbx", typeof(GameObject))]
        [TestCase("Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt Buster US.obj", typeof(GameObject))]
        [TestCase("Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt Buster.png", typeof(Texture2D))]
        [TestCase("Packages/com.ruincrawler.source-assets/models/reaverbots/Sharukurusu.obj", typeof(GameObject))]
        [TestCase("Packages/com.ruincrawler.source-assets/textures/ruins/floor_plain.png", typeof(Texture2D))]
        [TestCase("Packages/com.ruincrawler.source-assets/textures/ruins/wall_macro_industrial.png", typeof(Texture2D))]
        public void RequiredSourceAssetImports(string path, System.Type expectedType)
        {
            Object asset = AssetDatabase.LoadAssetAtPath(path, expectedType);
            Assert.That(asset, Is.Not.Null, $"Expected Unity to import {path}");
        }

        [Test]
        public void FirstSliceArtifactsExist()
        {
            Assert.That(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RuinCrawler/Prefabs/PlayerPrototype.prefab"), Is.Not.Null);
            Assert.That(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RuinCrawler/Prefabs/SharukurusuTarget.prefab"), Is.Not.Null);
            Assert.That(AssetDatabase.LoadAssetAtPath<SceneAsset>("Assets/RuinCrawler/Scenes/PortingSandbox.unity"), Is.Not.Null);

            PortingManifest manifest = AssetDatabase.LoadAssetAtPath<PortingManifest>("Assets/RuinCrawler/Porting/PortingManifest.asset");
            Assert.That(manifest, Is.Not.Null);
            Assert.That(manifest.Entries.Count, Is.GreaterThanOrEqualTo(5));
        }

        [Test]
        public void PlayerPrefabUsesSourceTraversalDimensions()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RuinCrawler/Prefabs/PlayerPrototype.prefab");
            CharacterController controller = prefab.GetComponent<CharacterController>();

            Assert.That(controller, Is.Not.Null);
            Assert.That(controller.height, Is.EqualTo(SourceGameplayContract.PlayerHeight).Within(0.0001f));
            Assert.That(controller.radius, Is.EqualTo(SourceGameplayContract.PlayerRadius).Within(0.0001f));
            Assert.That(prefab.GetComponent<PrototypePlayerController>(), Is.Not.Null);
        }

        [Test]
        public void PlayerPrefabOwnsAnimationOnTheCompatibleVisualRoot()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RuinCrawler/Prefabs/PlayerPrototype.prefab");
            Animator[] animators = prefab.GetComponentsInChildren<Animator>(true);

            Assert.That(animators, Has.Length.EqualTo(1));
            Animator animator = animators[0];
            Assert.That(animator.gameObject.name, Is.EqualTo("PlayerVisual_MegaManVolnutt"));
            Assert.That(animator.applyRootMotion, Is.False);
            Assert.That(animator.runtimeAnimatorController, Is.Not.Null);
            Assert.That(AssetDatabase.GetAssetPath(animator.runtimeAnimatorController),
                Is.EqualTo("Assets/RuinCrawler/Animation/VolnuttPrototype.controller"));
            Assert.That(animator.GetComponent<PrototypePlayerAnimationDriver>(), Is.Not.Null);

            Transform muzzle = prefab.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "BusterMuzzle");
            Assert.That(muzzle.parent.name, Is.EqualTo("MegaBuster_Left"));
            Assert.That(muzzle.parent.parent.name, Is.EqualTo("mixamorig:LeftForeArm"));
            PrototypePlayerAnimationDriver driver = animator.GetComponent<PrototypePlayerAnimationDriver>();
            Assert.That(driver.BusterShoulder.name, Is.EqualTo("mixamorig:LeftArm"));
            Assert.That(driver.BusterMuzzle, Is.SameAs(muzzle));
        }

        [Test]
        public void PlayerPrefabUsesAuthoredInvariantLeftMegaBuster()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/RuinCrawler/Prefabs/PlayerPrototype.prefab");
            GameObject instance = Object.Instantiate(prefab);
            try
            {
                PrototypeBusterVisual visual = instance.GetComponent<PrototypeBusterVisual>();
                Assert.That(visual, Is.Not.Null);
                Assert.That(visual.IsEquipped, Is.True);
                Assert.That(visual.BusterRoot, Is.Not.Null);
                Assert.That(visual.BusterRoot.name, Is.EqualTo("MegaBuster_Left"));
                Assert.That(visual.BusterRoot.transform.parent.name, Is.EqualTo("mixamorig:LeftForeArm"));

                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
                Renderer leftArm = renderers.Single(renderer => renderer.name.Contains("HandMesh_L"));
                Renderer rightArm = renderers.Single(renderer => renderer.name.Contains("HandMesh_R"));
                MeshRenderer busterRenderer = visual.BusterRoot.GetComponentInChildren<MeshRenderer>(true);
                Transform leftForeArm = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:LeftForeArm");
                Transform leftHand = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:LeftHand");
                Transform rightHand = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:RightHand");
                Transform muzzle = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "BusterMuzzle");

                Assert.That(leftArm.enabled, Is.False);
                Assert.That(rightArm.enabled, Is.True);
                Assert.That(busterRenderer, Is.Not.Null);
                Assert.That(AssetDatabase.GetAssetPath(busterRenderer.sharedMaterial.mainTexture),
                    Is.EqualTo("Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt Buster.png"));

                Vector3 forearm = leftHand.position - leftForeArm.position;
                Vector3 barrel = muzzle.position - leftForeArm.position;
                Assert.That(Vector3.Dot(forearm.normalized, barrel.normalized), Is.GreaterThan(0.999f));
                Assert.That(barrel.magnitude / forearm.magnitude,
                    Is.EqualTo(1.18f * 1.12f).Within(0.01f));
                Assert.That(Vector3.Distance(muzzle.position, leftHand.position),
                    Is.LessThan(Vector3.Distance(muzzle.position, rightHand.position)));

                visual.SetEquipped(false);
                Assert.That(visual.BusterRoot.activeSelf, Is.False);
                Assert.That(leftArm.enabled, Is.True);
                Assert.That(rightArm.enabled, Is.True);

                visual.SetEquipped(true);
                Assert.That(visual.BusterRoot.activeSelf, Is.True);
                Assert.That(leftArm.enabled, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void AnimationControllerHasStablePresentationContract()
        {
            AnimatorController controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(
                "Assets/RuinCrawler/Animation/VolnuttPrototype.controller");

            Assert.That(controller, Is.Not.Null);
            Assert.That(controller.layers.Select(layer => layer.name),
                Is.EquivalentTo(new[] { "Base Layer", "UpperBodyBuster" }));
            AnimatorControllerLayer busterLayer = controller.layers.Single(
                layer => layer.name == "UpperBodyBuster");
            Assert.That(busterLayer.defaultWeight, Is.EqualTo(0f));
            Assert.That(AssetDatabase.GetAssetPath(busterLayer.avatarMask),
                Is.EqualTo("Assets/RuinCrawler/Animation/VolnuttLeftBuster.mask"));
            Assert.That(busterLayer.stateMachine.states.All(child => !child.state.writeDefaultValues),
                Is.True, "The Buster layer must not reset the Action Idle body pose.");
            Assert.That(Enumerable.Range(0, busterLayer.avatarMask.transformCount)
                    .Where(busterLayer.avatarMask.GetTransformActive)
                    .Select(busterLayer.avatarMask.GetTransformPath),
                Does.Contain("mixamorig:Hips/mixamorig:Spine/mixamorig:Spine1/"
                             + "mixamorig:Spine2/mixamorig:LeftShoulder/"
                             + "mixamorig:LeftArm"));
            Assert.That(controller.parameters.Select(parameter => parameter.name),
                Is.EquivalentTo(new[]
                {
                    PrototypePlayerAnimationDriver.SpeedParameter,
                    PrototypePlayerAnimationDriver.CombatReadinessParameter,
                    PrototypePlayerAnimationDriver.GroundedParameter,
                    PrototypePlayerAnimationDriver.VerticalSpeedParameter,
                    PrototypePlayerAnimationDriver.AimingParameter,
                }));

            AnimatorStateMachine baseMachine = controller.layers.Single(layer => layer.name == "Base Layer").stateMachine;
            Assert.That(baseMachine.states.Select(state => state.state.name),
                Is.EquivalentTo(new[] { "Locomotion", "JumpRise", "JumpFall", "Land" }));
            AnimatorState locomotionState = baseMachine.states.Single(child => child.state.name == "Locomotion").state;
            Assert.That(locomotionState.motion, Is.TypeOf<BlendTree>());
            BlendTree locomotion = (BlendTree)locomotionState.motion;
            Assert.That(locomotion.children.Select(child => child.threshold),
                Is.EqualTo(new[]
                {
                    0f,
                    SourceGameplayContract.PlayerWalkSpeed,
                    SourceGameplayContract.PlayerJogSpeed,
                    SourceGameplayContract.PlayerSprintSpeed,
                }).Within(0.0001f));

            BlendTree idle = locomotion.children[0].motion as BlendTree;
            Assert.That(idle, Is.Not.Null);
            Assert.That(idle.blendParameter,
                Is.EqualTo(PrototypePlayerAnimationDriver.CombatReadinessParameter));
            Assert.That(idle.children.Select(child => child.motion.name),
                Is.EqualTo(new[] { "BreathingIdle", "ActionIdle" }));
            Assert.That(idle.children.Select(child => child.threshold),
                Is.EqualTo(new[] { 0f, 1f }).Within(0.0001f));
        }

        [TestCase("Packages/com.ruincrawler.source-assets/models/animations/Breathing Idle.fbx", "BreathingIdle")]
        [TestCase("Packages/com.ruincrawler.source-assets/models/animations/Side Idle.fbx", "ActionIdle")]
        [TestCase("Packages/com.ruincrawler.source-assets/models/animations/walking.fbx", "Walking")]
        [TestCase("Packages/com.ruincrawler.source-assets/models/animations/running.fbx", "Running")]
        [TestCase("Packages/com.ruincrawler.source-assets/models/animations/Sprint.fbx", "Sprint")]
        public void LocomotionClipImporterOwnsLoopAndRootPolicy(string path, string semanticName)
        {
            ModelImporter importer = (ModelImporter)AssetImporter.GetAtPath(path);
            ModelImporterClipAnimation clip = importer.clipAnimations.Single();

            Assert.That(importer.animationType, Is.EqualTo(ModelImporterAnimationType.Generic));
            Assert.That(importer.optimizeGameObjects, Is.False);
            Assert.That(clip.name, Is.EqualTo(semanticName));
            Assert.That(clip.loopTime, Is.True);
            Assert.That(clip.loopPose, Is.True);
            Assert.That(clip.lockRootPositionXZ, Is.True);
        }

        [Test]
        public void CoreAnimationBindingsResolveAgainstVolnuttHierarchy()
        {
            GameObject model = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt.fbx");
            HashSet<string> targetPaths = model.GetComponentsInChildren<Transform>(true)
                .Select(transform => AnimationUtility.CalculateTransformPath(transform, model.transform))
                .ToHashSet();
            string[] paths =
            {
                "Packages/com.ruincrawler.source-assets/models/animations/Breathing Idle.fbx",
                "Packages/com.ruincrawler.source-assets/models/animations/Side Idle.fbx",
                "Packages/com.ruincrawler.source-assets/models/animations/walking.fbx",
                "Packages/com.ruincrawler.source-assets/models/animations/running.fbx",
                "Packages/com.ruincrawler.source-assets/models/animations/Sprint.fbx",
                "Packages/com.ruincrawler.source-assets/models/animations/Jump Attack.fbx",
            };

            foreach (string path in paths)
            {
                foreach (AnimationClip clip in AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>())
                {
                    foreach (EditorCurveBinding binding in AnimationUtility.GetCurveBindings(clip)
                                 .Where(binding => binding.type == typeof(Transform)))
                    {
                        Assert.That(targetPaths, Does.Contain(binding.path),
                            $"{clip.name} contains an unmatched transform path: {binding.path}");
                    }
                }
            }
        }

        [Test]
        public void GeneratedLeftBusterPosePointsItsBarrelAlongGameplayForward()
        {
            GameObject modelAsset = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt.fbx");
            AnimationClip clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(
                "Assets/RuinCrawler/Animation/VolnuttLeftBusterAim.anim");
            Assert.That(AnimationUtility.GetCurveBindings(clip).All(
                    binding => binding.path.StartsWith("mixamorig:Hips/mixamorig:Spine/mixamorig:Spine1/"
                                                       + "mixamorig:Spine2/mixamorig:LeftShoulder/"
                                                       + "mixamorig:LeftArm")),
                Is.True,
                "Aiming must leave the Action Idle body and lower body untouched.");
            GameObject instance = Object.Instantiate(modelAsset);
            try
            {
                clip.SampleAnimation(instance, 0.5f);
                Transform elbow = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:LeftForeArm");
                Transform hand = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:LeftHand");
                Vector3 barrelDirection = (hand.position - elbow.position).normalized;

                Assert.That(Vector3.Dot(barrelDirection, instance.transform.forward), Is.GreaterThan(0.9999f));
                Assert.That(Mathf.Abs(Vector3.Dot(barrelDirection, instance.transform.up)), Is.LessThan(0.005f));
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void BreathingIdleAuthoredPelvisMotionKeepsFeetPlanted()
        {
            GameObject modelAsset = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt.fbx");
            AnimationClip clip = AssetDatabase.LoadAllAssetsAtPath(
                    "Packages/com.ruincrawler.source-assets/models/animations/Breathing Idle.fbx")
                .OfType<AnimationClip>()
                .Single(candidate => candidate.name == "BreathingIdle");
            GameObject playerPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                "Assets/RuinCrawler/Prefabs/PlayerPrototype.prefab");
            Transform prefabVisual = playerPrefab.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "PlayerVisual_MegaManVolnutt");
            GameObject instance = Object.Instantiate(modelAsset);
            instance.transform.localScale = prefabVisual.localScale;

            try
            {
                Transform leftFoot = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:LeftFoot");
                Transform rightFoot = instance.GetComponentsInChildren<Transform>(true)
                    .Single(transform => transform.name == "mixamorig:RightFoot");
                clip.SampleAnimation(instance, 0f);
                Vector3 leftStart = leftFoot.position;
                Vector3 rightStart = rightFoot.position;
                float leftMaximum = 0f;
                float rightMaximum = 0f;

                int sampleCount = Mathf.CeilToInt(clip.length * clip.frameRate);
                for (int index = 1; index <= sampleCount; index += 1)
                {
                    clip.SampleAnimation(instance, clip.length * index / sampleCount);
                    leftMaximum = Mathf.Max(leftMaximum, HorizontalDistance(leftStart, leftFoot.position));
                    rightMaximum = Mathf.Max(rightMaximum, HorizontalDistance(rightStart, rightFoot.position));
                }

                Assert.That(leftMaximum, Is.LessThanOrEqualTo(0.03f));
                Assert.That(rightMaximum, Is.LessThanOrEqualTo(0.03f));
                Assert.That(HorizontalDistance(leftStart, leftFoot.position), Is.LessThanOrEqualTo(0.002f));
                Assert.That(HorizontalDistance(rightStart, rightFoot.position), Is.LessThanOrEqualTo(0.002f));
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }
        }

        [Test]
        public void SourceCameraProjectionContractIsStable()
        {
            Assert.That(SourceGameplayContract.CameraFieldOfView, Is.EqualTo(48f));
            Assert.That(SourceGameplayContract.CameraNearClip, Is.EqualTo(0.1f));
            Assert.That(SourceGameplayContract.CameraFarClip, Is.EqualTo(120f));
        }

        [Test]
        public void SharukurusuPrefabUsesSourceCollisionAndHealthContract()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RuinCrawler/Prefabs/SharukurusuTarget.prefab");
            CapsuleCollider collider = prefab.GetComponent<CapsuleCollider>();
            PrototypeDamageTarget target = prefab.GetComponent<PrototypeDamageTarget>();

            Assert.That(collider.height, Is.EqualTo(SourceGameplayContract.SharukurusuHeight).Within(0.0001f));
            Assert.That(collider.radius, Is.EqualTo(SourceGameplayContract.SharukurusuRadius).Within(0.0001f));
            Assert.That(target.MaximumHealth, Is.EqualTo(SourceGameplayContract.SharukurusuHealth).Within(0.0001f));
        }

        private static float HorizontalDistance(Vector3 first, Vector3 second)
        {
            return Vector2.Distance(
                new Vector2(first.x, first.z),
                new Vector2(second.x, second.z));
        }
    }
}
