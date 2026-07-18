using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace RuinCrawler.Port.Editor
{
    public static class RuinCrawlerPlayerAnimationSetup
    {
        public const string AnimationFolder = "Assets/RuinCrawler/Animation";
        public const string ControllerPath = AnimationFolder + "/VolnuttPrototype.controller";
        public const string BusterAimClipPath = AnimationFolder + "/VolnuttLeftBusterAim.anim";
        public const string BusterOffClipPath = AnimationFolder + "/VolnuttBusterOff.anim";
        public const string BusterMaskPath = AnimationFolder + "/VolnuttLeftBuster.mask";

        public const string PlayerModelPath = "Packages/com.ruincrawler.source-assets/models/Mega Man Volnutt.fbx";
        public const string BreathingIdlePath = "Packages/com.ruincrawler.source-assets/models/animations/Breathing Idle.fbx";
        public const string ActionIdlePath = "Packages/com.ruincrawler.source-assets/models/animations/Side Idle.fbx";
        public const string WalkingPath = "Packages/com.ruincrawler.source-assets/models/animations/walking.fbx";
        public const string RunningPath = "Packages/com.ruincrawler.source-assets/models/animations/running.fbx";
        public const string SprintPath = "Packages/com.ruincrawler.source-assets/models/animations/Sprint.fbx";
        public const string JumpAttackPath = "Packages/com.ruincrawler.source-assets/models/animations/Jump Attack.fbx";

        public const string BreathingIdleClip = "BreathingIdle";
        public const string ActionIdleClip = "ActionIdle";
        public const string WalkingClip = "Walking";
        public const string RunningClip = "Running";
        public const string SprintClip = "Sprint";
        public const string JumpRiseClip = "ForwardJumpLaunch";
        public const string JumpFallClip = "ForwardJumpFall";
        public const string JumpLandClip = "ForwardJumpLanding";

        private const string HipsBone = "mixamorig:Hips";
        private const string LeftShoulderBone = "mixamorig:LeftArm";
        private const string LeftElbowBone = "mixamorig:LeftForeArm";
        private const string LeftWristBone = "mixamorig:LeftHand";
        private const string LeftArmMaskRoot = "mixamorig:Hips/mixamorig:Spine/mixamorig:Spine1/"
                                               + "mixamorig:Spine2/mixamorig:LeftShoulder/"
                                               + "mixamorig:LeftArm";

        [MenuItem("Ruin Crawler/Porting/Rebuild Player Animations")]
        public static void RebuildPlayerAnimationsMenu()
        {
            RuntimeAnimatorController controller = BuildPlayerAnimations();
            Debug.Log($"Ruin Crawler player animations rebuilt: {AssetDatabase.GetAssetPath(controller)}");
        }

        public static RuntimeAnimatorController BuildPlayerAnimations()
        {
            EnsureFolder(AnimationFolder);
            ConfigureModelImporter();
            ConfigureSingleClip(BreathingIdlePath, BreathingIdleClip, loop: true, lockRootY: false);
            ConfigureSingleClip(ActionIdlePath, ActionIdleClip, loop: true, lockRootY: false);
            ConfigureSingleClip(WalkingPath, WalkingClip, loop: true, lockRootY: false);
            ConfigureSingleClip(RunningPath, RunningClip, loop: true, lockRootY: false);
            ConfigureSingleClip(SprintPath, SprintClip, loop: true, lockRootY: false);
            ConfigureJumpAttackClips();

            AnimationClip breathingIdle = LoadClip(BreathingIdlePath, BreathingIdleClip);
            AnimationClip actionIdle = LoadClip(ActionIdlePath, ActionIdleClip);
            AnimationClip walking = LoadClip(WalkingPath, WalkingClip);
            AnimationClip running = LoadClip(RunningPath, RunningClip);
            AnimationClip sprint = LoadClip(SprintPath, SprintClip);
            AnimationClip jumpRise = LoadClip(JumpAttackPath, JumpRiseClip);
            AnimationClip jumpFall = LoadClip(JumpAttackPath, JumpFallClip);
            AnimationClip jumpLand = LoadClip(JumpAttackPath, JumpLandClip);
            AnimationClip busterAim = CreateBusterAimClip();
            AnimationClip busterOff = CreateEmptyLoopClip(BusterOffClipPath, "VolnuttBusterOff");
            AvatarMask busterMask = CreateBusterMask();

            AnimatorController controller = RebuildController(
                breathingIdle,
                actionIdle,
                walking,
                running,
                sprint,
                jumpRise,
                jumpFall,
                jumpLand,
                busterOff,
                busterAim,
                busterMask);
            AssetDatabase.SaveAssets();
            return controller;
        }

        private static void ConfigureModelImporter()
        {
            if (AssetImporter.GetAtPath(PlayerModelPath) is not ModelImporter importer)
            {
                throw new InvalidOperationException($"Volnutt model importer was not found: {PlayerModelPath}");
            }

            bool changed = importer.animationType != ModelImporterAnimationType.Generic
                           || importer.avatarSetup != ModelImporterAvatarSetup.NoAvatar
                           || importer.optimizeGameObjects
                           || !importer.preserveHierarchy;
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
            importer.optimizeGameObjects = false;
            importer.preserveHierarchy = true;
            if (changed)
            {
                importer.SaveAndReimport();
            }
        }

        private static void ConfigureSingleClip(string path, string semanticName, bool loop, bool lockRootY)
        {
            ModelImporter importer = RequireModelImporter(path);
            ModelImporterClipAnimation source = importer.defaultClipAnimations.FirstOrDefault();
            if (source == null)
            {
                throw new InvalidOperationException($"Animation FBX has no default clip: {path}");
            }

            ModelImporterClipAnimation configured = CreateClipDefinition(
                source,
                semanticName,
                source.firstFrame,
                source.lastFrame,
                loop,
                lockRootY);
            ApplyClipImporter(importer, new[] { configured });
        }

        private static void ConfigureJumpAttackClips()
        {
            ModelImporter importer = RequireModelImporter(JumpAttackPath);
            ModelImporterClipAnimation source = importer.defaultClipAnimations.FirstOrDefault();
            if (source == null)
            {
                throw new InvalidOperationException($"Animation FBX has no default clip: {JumpAttackPath}");
            }

            float finalFrame = source.lastFrame;
            ModelImporterClipAnimation[] clips =
            {
                CreateClipDefinition(source, JumpRiseClip, 0f, Mathf.Min(32f, finalFrame), false, true),
                CreateClipDefinition(source, JumpFallClip, Mathf.Min(33f, finalFrame), Mathf.Min(42f, finalFrame), false, true),
                CreateClipDefinition(source, JumpLandClip, Mathf.Min(53f, finalFrame), Mathf.Min(89f, finalFrame), false, true),
            };
            ApplyClipImporter(importer, clips);
        }

        private static ModelImporterClipAnimation CreateClipDefinition(
            ModelImporterClipAnimation source,
            string name,
            float firstFrame,
            float lastFrame,
            bool loop,
            bool lockRootY)
        {
            return new ModelImporterClipAnimation
            {
                name = name,
                takeName = source.takeName,
                firstFrame = firstFrame,
                lastFrame = lastFrame,
                loopTime = loop,
                loopPose = loop,
                lockRootPositionXZ = true,
                lockRootHeightY = lockRootY,
                lockRootRotation = false,
                keepOriginalPositionXZ = false,
                keepOriginalPositionY = !lockRootY,
                keepOriginalOrientation = true,
            };
        }

        private static void ApplyClipImporter(ModelImporter importer, ModelImporterClipAnimation[] clips)
        {
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
            importer.importAnimation = true;
            importer.optimizeGameObjects = false;
            importer.preserveHierarchy = true;
            importer.clipAnimations = clips;
            importer.SaveAndReimport();
        }

        private static ModelImporter RequireModelImporter(string path)
        {
            if (AssetImporter.GetAtPath(path) is ModelImporter importer)
            {
                return importer;
            }
            throw new InvalidOperationException($"Animation importer was not found: {path}");
        }

        private static AnimationClip LoadClip(string path, string semanticName)
        {
            AnimationClip clip = AssetDatabase.LoadAllAssetsAtPath(path)
                .OfType<AnimationClip>()
                .FirstOrDefault(candidate => candidate.name == semanticName);
            if (clip == null)
            {
                throw new InvalidOperationException($"Configured animation clip '{semanticName}' was not imported from {path}");
            }
            return clip;
        }

        private static AnimationClip CreateBusterAimClip()
        {
            GameObject modelAsset = AssetDatabase.LoadAssetAtPath<GameObject>(PlayerModelPath);
            if (modelAsset == null)
            {
                throw new InvalidOperationException($"Volnutt model was not imported: {PlayerModelPath}");
            }

            GameObject instance = UnityEngine.Object.Instantiate(modelAsset);
            instance.hideFlags = HideFlags.HideAndDontSave;
            try
            {
                AnimationClip clip = LoadOrCreateClip(BusterAimClipPath, "VolnuttLeftBusterAim");
                ClearCurves(clip);
                ApplySourcePose(instance.transform, LeftShoulderBone, new Vector3(59f, -22.5f, 102.5f));
                ApplySourcePose(instance.transform, LeftElbowBone, new Vector3(2.2f, 2.6f, 1.5f));
                ApplySourcePose(instance.transform, LeftWristBone, new Vector3(-17.1f, 14.9f, -1f));
                AlignBusterBarrelWithForward(instance.transform);
                AddRotationCurves(clip, instance.transform, LeftShoulderBone);
                AddRotationCurves(clip, instance.transform, LeftElbowBone);
                AddRotationCurves(clip, instance.transform, LeftWristBone);
                SetLooping(clip, true);
                EditorUtility.SetDirty(clip);
                return clip;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        private static AnimationClip CreateEmptyLoopClip(string path, string name)
        {
            AnimationClip clip = LoadOrCreateClip(path, name);
            ClearCurves(clip);
            SetLooping(clip, true);
            EditorUtility.SetDirty(clip);
            return clip;
        }

        private static AvatarMask CreateBusterMask()
        {
            GameObject modelAsset = AssetDatabase.LoadAssetAtPath<GameObject>(PlayerModelPath);
            if (modelAsset == null)
            {
                throw new InvalidOperationException($"Volnutt model was not imported: {PlayerModelPath}");
            }

            AvatarMask mask = AssetDatabase.LoadAssetAtPath<AvatarMask>(BusterMaskPath);
            if (mask == null)
            {
                mask = new AvatarMask { name = "VolnuttLeftBuster" };
                AssetDatabase.CreateAsset(mask, BusterMaskPath);
            }

            string[] paths = modelAsset.GetComponentsInChildren<Transform>(true)
                .Select(transform => AnimationUtility.CalculateTransformPath(transform, modelAsset.transform))
                .ToArray();
            mask.transformCount = paths.Length;
            for (int index = 0; index < paths.Length; index += 1)
            {
                string path = paths[index];
                bool isAncestor = string.IsNullOrEmpty(path)
                                  || LeftArmMaskRoot.StartsWith(path + "/", StringComparison.Ordinal);
                bool isArm = path == LeftArmMaskRoot
                             || path.StartsWith(LeftArmMaskRoot + "/", StringComparison.Ordinal);
                mask.SetTransformPath(index, path);
                mask.SetTransformActive(index, isAncestor || isArm);
            }
            for (int index = 0; index < (int)AvatarMaskBodyPart.LastBodyPart; index += 1)
            {
                mask.SetHumanoidBodyPartActive((AvatarMaskBodyPart)index, false);
            }
            EditorUtility.SetDirty(mask);
            return mask;
        }

        private static AnimationClip LoadOrCreateClip(string path, string name)
        {
            AnimationClip clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
            if (clip == null)
            {
                clip = new AnimationClip();
                AssetDatabase.CreateAsset(clip, path);
            }
            clip.name = name;
            clip.frameRate = 30f;
            return clip;
        }

        private static void ClearCurves(AnimationClip clip)
        {
            foreach (EditorCurveBinding binding in AnimationUtility.GetCurveBindings(clip))
            {
                AnimationUtility.SetEditorCurve(clip, binding, null);
            }
        }

        private static void ApplySourcePose(
            Transform modelRoot,
            string boneName,
            Vector3 sourceEulerDegrees)
        {
            Transform bone = FindDescendant(modelRoot, boneName);
            if (bone == null)
            {
                throw new InvalidOperationException($"Required Volnutt animation bone is missing: {boneName}");
            }

            Quaternion delta = QuaternionFromEulerXyz(sourceEulerDegrees * Mathf.Deg2Rad);
            bone.localRotation = (bone.localRotation * delta).normalized;
        }

        private static void AlignBusterBarrelWithForward(Transform modelRoot)
        {
            Transform shoulder = FindDescendant(modelRoot, LeftShoulderBone);
            Transform elbow = FindDescendant(modelRoot, LeftElbowBone);
            Transform hand = FindDescendant(modelRoot, LeftWristBone);
            Vector3 currentDirection = hand.position - elbow.position;
            if (currentDirection.sqrMagnitude <= 0.000001f)
            {
                throw new InvalidOperationException("Volnutt Buster has no measurable elbow-to-muzzle direction.");
            }

            Quaternion forwardCorrection = Quaternion.FromToRotation(
                currentDirection.normalized,
                modelRoot.forward);
            shoulder.rotation = (forwardCorrection * shoulder.rotation).normalized;
        }

        private static void AddRotationCurves(AnimationClip clip, Transform modelRoot, string boneName)
        {
            Transform bone = FindDescendant(modelRoot, boneName);
            string path = AnimationUtility.CalculateTransformPath(bone, modelRoot);
            Quaternion target = bone.localRotation.normalized;
            SetConstantCurve(clip, path, "m_LocalRotation.x", target.x);
            SetConstantCurve(clip, path, "m_LocalRotation.y", target.y);
            SetConstantCurve(clip, path, "m_LocalRotation.z", target.z);
            SetConstantCurve(clip, path, "m_LocalRotation.w", target.w);
        }

        private static void SetConstantCurve(AnimationClip clip, string path, string property, float value)
        {
            EditorCurveBinding binding = EditorCurveBinding.FloatCurve(path, typeof(Transform), property);
            AnimationUtility.SetEditorCurve(clip, binding, AnimationCurve.Constant(0f, 1f, value));
        }

        private static Quaternion QuaternionFromEulerXyz(Vector3 radians)
        {
            float c1 = Mathf.Cos(radians.x * 0.5f);
            float c2 = Mathf.Cos(radians.y * 0.5f);
            float c3 = Mathf.Cos(radians.z * 0.5f);
            float s1 = Mathf.Sin(radians.x * 0.5f);
            float s2 = Mathf.Sin(radians.y * 0.5f);
            float s3 = Mathf.Sin(radians.z * 0.5f);
            Quaternion source = new Quaternion(
                s1 * c2 * c3 + c1 * s2 * s3,
                c1 * s2 * c3 - s1 * c2 * s3,
                c1 * c2 * s3 + s1 * s2 * c3,
                c1 * c2 * c3 - s1 * s2 * s3).normalized;
            // FBX import crosses the Three.js/Unity handedness boundary by
            // reflecting X. Convert the source-local rotation before it is
            // composed with Unity's imported bind pose.
            return new Quaternion(source.x, -source.y, -source.z, source.w).normalized;
        }

        private static void SetLooping(AnimationClip clip, bool loop)
        {
            AnimationClipSettings settings = AnimationUtility.GetAnimationClipSettings(clip);
            settings.loopTime = loop;
            AnimationUtility.SetAnimationClipSettings(clip, settings);
        }

        private static AnimatorController RebuildController(
            AnimationClip breathingIdle,
            AnimationClip actionIdle,
            AnimationClip walking,
            AnimationClip running,
            AnimationClip sprint,
            AnimationClip jumpRise,
            AnimationClip jumpFall,
            AnimationClip jumpLand,
            AnimationClip busterOff,
            AnimationClip busterAim,
            AvatarMask busterMask)
        {
            AnimatorController controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath);
            if (controller == null)
            {
                controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            }

            controller.layers = Array.Empty<AnimatorControllerLayer>();
            controller.parameters = Array.Empty<AnimatorControllerParameter>();
            AssetDatabase.SaveAssets();
            foreach (UnityEngine.Object subAsset in AssetDatabase.LoadAllAssetsAtPath(ControllerPath)
                         .Where(asset => asset != controller)
                         .ToArray())
            {
                UnityEngine.Object.DestroyImmediate(subAsset, true);
            }

            controller.AddParameter(PrototypePlayerAnimationDriver.SpeedParameter, AnimatorControllerParameterType.Float);
            controller.AddParameter(PrototypePlayerAnimationDriver.CombatReadinessParameter, AnimatorControllerParameterType.Float);
            controller.AddParameter(new AnimatorControllerParameter
            {
                name = PrototypePlayerAnimationDriver.GroundedParameter,
                type = AnimatorControllerParameterType.Bool,
                defaultBool = true,
            });
            controller.AddParameter(PrototypePlayerAnimationDriver.VerticalSpeedParameter, AnimatorControllerParameterType.Float);
            controller.AddParameter(PrototypePlayerAnimationDriver.AimingParameter, AnimatorControllerParameterType.Bool);

            AnimatorStateMachine baseMachine = new AnimatorStateMachine { name = "Base Layer" };
            AssetDatabase.AddObjectToAsset(baseMachine, controller);
            BlendTree idle = new BlendTree
            {
                name = "CombatToNeutralIdle",
                blendType = BlendTreeType.Simple1D,
                blendParameter = PrototypePlayerAnimationDriver.CombatReadinessParameter,
                useAutomaticThresholds = false,
            };
            AssetDatabase.AddObjectToAsset(idle, controller);
            idle.AddChild(breathingIdle, 0f);
            idle.AddChild(actionIdle, 1f);

            BlendTree locomotion = new BlendTree
            {
                name = "SourceLocomotion",
                blendType = BlendTreeType.Simple1D,
                blendParameter = PrototypePlayerAnimationDriver.SpeedParameter,
                useAutomaticThresholds = false,
            };
            AssetDatabase.AddObjectToAsset(locomotion, controller);
            locomotion.AddChild(idle, 0f);
            locomotion.AddChild(walking, SourceGameplayContract.PlayerWalkSpeed);
            locomotion.AddChild(running, SourceGameplayContract.PlayerJogSpeed);
            locomotion.AddChild(sprint, SourceGameplayContract.PlayerSprintSpeed);

            AnimatorState locomotionState = baseMachine.AddState("Locomotion", new Vector3(220f, 100f));
            locomotionState.motion = locomotion;
            AnimatorState riseState = baseMachine.AddState("JumpRise", new Vector3(470f, 10f));
            riseState.motion = jumpRise;
            AnimatorState fallState = baseMachine.AddState("JumpFall", new Vector3(690f, 10f));
            fallState.motion = jumpFall;
            AnimatorState landState = baseMachine.AddState("Land", new Vector3(470f, 190f));
            landState.motion = jumpLand;
            landState.speed = Mathf.Max(1f, jumpLand.length / SourceGameplayContract.PlayerLandingRecoveryTime);
            baseMachine.defaultState = locomotionState;

            AnimatorStateTransition locomotionToRise = AddTransition(locomotionState, riseState, 0.12f);
            locomotionToRise.AddCondition(AnimatorConditionMode.IfNot, 0f, PrototypePlayerAnimationDriver.GroundedParameter);
            locomotionToRise.AddCondition(AnimatorConditionMode.Greater, 0.01f, PrototypePlayerAnimationDriver.VerticalSpeedParameter);
            AnimatorStateTransition locomotionToFall = AddTransition(locomotionState, fallState, 0.12f);
            locomotionToFall.AddCondition(AnimatorConditionMode.IfNot, 0f, PrototypePlayerAnimationDriver.GroundedParameter);
            locomotionToFall.AddCondition(AnimatorConditionMode.Less, -0.01f, PrototypePlayerAnimationDriver.VerticalSpeedParameter);
            AnimatorStateTransition riseToFall = AddTransition(riseState, fallState, 0.12f);
            riseToFall.AddCondition(AnimatorConditionMode.Less, 0f, PrototypePlayerAnimationDriver.VerticalSpeedParameter);
            AnimatorStateTransition riseToLand = AddTransition(riseState, landState, 0.08f);
            riseToLand.AddCondition(AnimatorConditionMode.If, 0f, PrototypePlayerAnimationDriver.GroundedParameter);
            AnimatorStateTransition fallToLand = AddTransition(fallState, landState, 0.08f);
            fallToLand.AddCondition(AnimatorConditionMode.If, 0f, PrototypePlayerAnimationDriver.GroundedParameter);
            AnimatorStateTransition landToLocomotion = landState.AddTransition(locomotionState);
            landToLocomotion.hasExitTime = true;
            landToLocomotion.exitTime = 0.9f;
            landToLocomotion.duration = 0.08f;

            AnimatorStateMachine busterMachine = new AnimatorStateMachine { name = "UpperBodyBuster" };
            AssetDatabase.AddObjectToAsset(busterMachine, controller);
            AnimatorState busterOffState = busterMachine.AddState("BusterOff", new Vector3(230f, 70f));
            busterOffState.motion = busterOff;
            busterOffState.writeDefaultValues = false;
            AnimatorState busterAimState = busterMachine.AddState("BusterAim", new Vector3(470f, 70f));
            busterAimState.motion = busterAim;
            busterAimState.writeDefaultValues = false;
            busterMachine.defaultState = busterOffState;
            AnimatorStateTransition aimOn = AddTransition(busterOffState, busterAimState, 0.08f);
            aimOn.AddCondition(AnimatorConditionMode.If, 0f, PrototypePlayerAnimationDriver.AimingParameter);
            AnimatorStateTransition aimOff = AddTransition(busterAimState, busterOffState, 0.1f);
            aimOff.AddCondition(AnimatorConditionMode.IfNot, 0f, PrototypePlayerAnimationDriver.AimingParameter);

            controller.layers = new[]
            {
                new AnimatorControllerLayer
                {
                    name = "Base Layer",
                    defaultWeight = 1f,
                    stateMachine = baseMachine,
                    syncedLayerIndex = -1,
                },
                new AnimatorControllerLayer
                {
                    name = "UpperBodyBuster",
                    defaultWeight = 0f,
                    blendingMode = AnimatorLayerBlendingMode.Override,
                    avatarMask = busterMask,
                    stateMachine = busterMachine,
                    syncedLayerIndex = -1,
                },
            };
            EditorUtility.SetDirty(controller);
            return controller;
        }

        private static AnimatorStateTransition AddTransition(AnimatorState source, AnimatorState target, float duration)
        {
            AnimatorStateTransition transition = source.AddTransition(target);
            transition.hasExitTime = false;
            transition.duration = duration;
            transition.canTransitionToSelf = false;
            return transition;
        }

        private static Transform FindDescendant(Transform root, string targetName)
        {
            return root.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(candidate => candidate.name == targetName);
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
    }
}
