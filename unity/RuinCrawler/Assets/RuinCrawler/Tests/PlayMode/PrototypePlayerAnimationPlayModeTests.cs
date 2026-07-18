using System.Collections;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace RuinCrawler.Port.Tests
{
    public sealed class PrototypePlayerAnimationPlayModeTests
    {
        [UnityTearDown]
        public IEnumerator RemoveSandboxObjects()
        {
            Time.timeScale = 1f;
            Scene sandbox = SceneManager.GetSceneByName("PortingSandbox");
            if (sandbox.IsValid() && sandbox.isLoaded)
            {
                foreach (GameObject root in sandbox.GetRootGameObjects())
                {
                    Object.Destroy(root);
                }
                yield return null;
            }
        }

        [UnityTest]
        public IEnumerator LocomotionAndBusterOverlayAdvanceWithoutRootDrift()
        {
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerAnimationDriver driver = Object.FindAnyObjectByType<PrototypePlayerAnimationDriver>();
            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            Assert.That(driver, Is.Not.Null);
            Assert.That(controller, Is.Not.Null);
            controller.enabled = false;

            Animator animator = driver.Animator;
            Assert.That(animator.applyRootMotion, Is.False);
            Assert.That(animator.GetCurrentAnimatorStateInfo(0).IsName("Locomotion"), Is.True);

            Vector3 playerPosition = controller.transform.position;
            Vector3 hipsPosition = driver.Hips.localPosition;
            float elapsed = 0f;
            while (elapsed < 0.5f)
            {
                driver.ApplyMotion(
                    Vector3.forward * SourceGameplayContract.PlayerJogSpeed,
                    true,
                    0f,
                    Time.deltaTime);
                elapsed += Time.deltaTime;
                yield return null;
            }

            Assert.That(animator.GetFloat(PrototypePlayerAnimationDriver.SpeedHash),
                Is.EqualTo(SourceGameplayContract.PlayerJogSpeed).Within(0.1f));
            Assert.That(animator.GetCurrentAnimatorStateInfo(0).IsName("Locomotion"), Is.True);
            Assert.That(controller.transform.position, Is.EqualTo(playerPosition));
            Assert.That(driver.Hips.localPosition.x, Is.EqualTo(hipsPosition.x).Within(0.0001f));
            Assert.That(driver.Hips.localPosition.z, Is.EqualTo(hipsPosition.z).Within(0.0001f));

            driver.NotifyShotFired();
            yield return new WaitForSeconds(0.15f);
            Assert.That(driver.IsAiming, Is.True);
            Assert.That(animator.GetCurrentAnimatorStateInfo(1).IsName("BusterAim"), Is.True);
            Assert.That(animator.GetLayerWeight(animator.GetLayerIndex(PrototypePlayerAnimationDriver.BusterLayer)),
                Is.GreaterThan(0.9f));
            Transform muzzle = controller.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "BusterMuzzle");
            Assert.That(muzzle.parent.name, Is.EqualTo("MegaBuster_Left"));
            Assert.That(muzzle.parent.parent.name, Is.EqualTo("mixamorig:LeftForeArm"));
            Assert.That(controller.BusterVisual.IsEquipped, Is.True);
            Assert.That(controller.BusterVisual.BusterRoot.activeSelf, Is.True);
            Assert.That(Vector3.Dot(muzzle.forward, controller.transform.forward), Is.GreaterThan(0.9999f));
            Assert.That(Mathf.Abs(Vector3.Dot(muzzle.forward, controller.transform.up)), Is.LessThan(0.001f));

            driver.SetAiming(false);
            yield return new WaitForSeconds(0.15f);
            Assert.That(driver.IsAiming, Is.False);
            Assert.That(animator.GetLayerWeight(animator.GetLayerIndex(PrototypePlayerAnimationDriver.BusterLayer)),
                Is.LessThan(0.01f));
        }

        [UnityTest]
        public IEnumerator GameplayOwnedVerticalStateDrivesJumpRiseFallAndLand()
        {
            Time.timeScale = 1f;
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerAnimationDriver driver = Object.FindAnyObjectByType<PrototypePlayerAnimationDriver>();
            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            controller.enabled = false;
            driver.ApplyMotion(Vector3.zero, true, 0f, 0.016f);
            float settleTimeout = Time.realtimeSinceStartup + 1f;
            while ((!driver.Animator.GetCurrentAnimatorStateInfo(0).IsName("Locomotion")
                    || driver.Animator.IsInTransition(0))
                   && Time.realtimeSinceStartup < settleTimeout)
            {
                yield return null;
            }
            Assert.That(driver.Animator.GetCurrentAnimatorStateInfo(0).IsName("Locomotion")
                        && !driver.Animator.IsInTransition(0),
                Is.True,
                "Animator did not finish entering its default locomotion graph.");

            driver.ApplyMotion(Vector3.up * 10f, false, 10f, 0.016f);
            float timeout = Time.realtimeSinceStartup + 1f;
            while (!IsCurrentOrNext(driver.Animator, "JumpRise") && Time.realtimeSinceStartup < timeout)
            {
                yield return null;
            }
            Assert.That(IsCurrentOrNext(driver.Animator, "JumpRise"), Is.True,
                "Jump rise state did not activate. " + DescribeAnimator(driver.Animator));

            driver.ApplyMotion(Vector3.down * 5f, false, -5f, 0.016f);
            timeout = Time.realtimeSinceStartup + 1f;
            while (!IsCurrentOrNext(driver.Animator, "JumpFall") && Time.realtimeSinceStartup < timeout)
            {
                yield return null;
            }
            Assert.That(IsCurrentOrNext(driver.Animator, "JumpFall"), Is.True, "Jump fall state did not activate.");

            driver.ApplyMotion(Vector3.zero, true, 0f, 0.016f);
            timeout = Time.realtimeSinceStartup + 1f;
            while (!IsCurrentOrNext(driver.Animator, "Land") && Time.realtimeSinceStartup < timeout)
            {
                yield return null;
            }
            Assert.That(IsCurrentOrNext(driver.Animator, "Land"), Is.True, "Landing state did not activate.");
        }

        [UnityTest]
        public IEnumerator CombatActivityUsesActionIdleThenBreathingIdleAfterTwentySeconds()
        {
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerAnimationDriver driver = Object.FindAnyObjectByType<PrototypePlayerAnimationDriver>();
            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            controller.enabled = false;
            driver.ApplyMotion(Vector3.zero, true, 0f, 0.016f);
            float clipTimeout = Time.realtimeSinceStartup + 1f;
            while (CurrentClipWeight(driver.Animator, "ActionIdle") <= 0.9f
                   && Time.realtimeSinceStartup < clipTimeout)
            {
                yield return null;
            }

            Assert.That(driver.IsCombatReady, Is.True);
            Assert.That(driver.Animator.GetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash),
                Is.GreaterThan(0.99f));
            Assert.That(CurrentClipWeight(driver.Animator, "ActionIdle"), Is.GreaterThan(0.9f),
                "Action Idle was not selected for the initial combat-ready window.");

            Time.timeScale = 100f;
            float timeout = Time.realtimeSinceStartup + 3f;
            while (driver.IsCombatReady && Time.realtimeSinceStartup < timeout)
            {
                yield return null;
            }
            Time.timeScale = 1f;
            clipTimeout = Time.realtimeSinceStartup + 1f;
            while ((CurrentClipWeight(driver.Animator, "BreathingIdle") <= 0.99f
                    || driver.Animator.GetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash) >= 0.01f)
                   && Time.realtimeSinceStartup < clipTimeout)
            {
                yield return null;
            }

            Assert.That(driver.IsCombatReady, Is.False, "Combat-ready idle did not expire after 20 seconds.");
            Assert.That(driver.Animator.GetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash),
                Is.LessThan(0.01f));
            Assert.That(CurrentClipWeight(driver.Animator, "BreathingIdle"), Is.GreaterThan(0.9f));

            driver.NotifyCombatActivity();
            clipTimeout = Time.realtimeSinceStartup + 1f;
            while ((CurrentClipWeight(driver.Animator, "ActionIdle") <= 0.99f
                    || driver.Animator.GetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash) <= 0.99f)
                   && Time.realtimeSinceStartup < clipTimeout)
            {
                yield return null;
            }
            Assert.That(driver.IsCombatReady, Is.True);
            Assert.That(CurrentClipWeight(driver.Animator, "ActionIdle"), Is.GreaterThan(0.9f),
                "Combat activity did not restore Action Idle.");
        }

        [UnityTest]
        public IEnumerator BreathingIdlePreservesFootPlantingWithoutMovingGameplayRoot()
        {
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerAnimationDriver driver = Object.FindAnyObjectByType<PrototypePlayerAnimationDriver>();
            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            controller.enabled = false;
            driver.ApplyMotion(Vector3.zero, true, 0f, 0.016f);

            Time.timeScale = 100f;
            float timeout = Time.realtimeSinceStartup + 3f;
            while (driver.IsCombatReady && Time.realtimeSinceStartup < timeout)
            {
                yield return null;
            }
            Time.timeScale = 1f;
            float clipTimeout = Time.realtimeSinceStartup + 1f;
            while ((CurrentClipWeight(driver.Animator, "BreathingIdle") <= 0.99f
                    || driver.IdleRootPreserveWeight <= 0.99f
                    || driver.Animator.GetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash) >= 0.01f)
                   && Time.realtimeSinceStartup < clipTimeout)
            {
                yield return null;
            }

            Animator animator = driver.Animator;
            Assert.That(CurrentClipWeight(animator, "BreathingIdle"), Is.GreaterThan(0.9f));
            Transform leftFoot = controller.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "mixamorig:LeftFoot");
            Transform rightFoot = controller.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "mixamorig:RightFoot");
            Vector3 playerStart = controller.transform.position;
            Vector3 leftStart = leftFoot.position;
            Vector3 rightStart = rightFoot.position;
            float hipsMinimumX = driver.Hips.localPosition.x;
            float hipsMaximumX = hipsMinimumX;
            float leftMaximum = 0f;
            float rightMaximum = 0f;
            AnimationClip breathing = animator.runtimeAnimatorController.animationClips
                .Single(clip => clip.name == "BreathingIdle");
            animator.speed = 4f;
            float endTime = Time.time + breathing.length / animator.speed + 0.1f;
            while (Time.time < endTime)
            {
                leftMaximum = Mathf.Max(leftMaximum, HorizontalDistance(leftStart, leftFoot.position));
                rightMaximum = Mathf.Max(rightMaximum, HorizontalDistance(rightStart, rightFoot.position));
                hipsMinimumX = Mathf.Min(hipsMinimumX, driver.Hips.localPosition.x);
                hipsMaximumX = Mathf.Max(hipsMaximumX, driver.Hips.localPosition.x);
                yield return null;
            }
            animator.speed = 1f;

            Assert.That(leftMaximum, Is.LessThanOrEqualTo(0.03f));
            Assert.That(rightMaximum, Is.LessThanOrEqualTo(0.03f));
            Assert.That(Vector3.Distance(controller.transform.position, playerStart), Is.LessThanOrEqualTo(0.001f));
            Assert.That(hipsMaximumX - hipsMinimumX, Is.GreaterThan(0.0005f),
                "The authored pelvis compensation was stripped, which reintroduces foot slide.");
            Assert.That(driver.IdleRootPreserveWeight, Is.GreaterThan(0.99f));
        }

        [UnityTest]
        public IEnumerator BusterAimOverlayPreservesTheActionIdleBodyPose()
        {
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerAnimationDriver driver = Object.FindAnyObjectByType<PrototypePlayerAnimationDriver>();
            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            controller.enabled = false;
            Animator animator = driver.Animator;
            int busterLayer = animator.GetLayerIndex(PrototypePlayerAnimationDriver.BusterLayer);
            animator.SetFloat(PrototypePlayerAnimationDriver.SpeedHash, 0f);
            animator.SetFloat(PrototypePlayerAnimationDriver.CombatReadinessHash, 1f);
            animator.SetBool(PrototypePlayerAnimationDriver.GroundedHash, true);
            animator.SetBool(PrototypePlayerAnimationDriver.AimingHash, false);
            animator.Play("Locomotion", 0, 0.22f);
            animator.Play("BusterOff", busterLayer, 0f);
            animator.SetLayerWeight(busterLayer, 0f);
            animator.Update(0f);
            animator.speed = 0f;

            string[] stableBoneNames =
            {
                "mixamorig:Hips",
                "mixamorig:Spine2",
                "mixamorig:RightArm",
                "mixamorig:RightForeArm",
                "mixamorig:LeftUpLeg",
                "mixamorig:LeftLeg",
                "mixamorig:RightUpLeg",
                "mixamorig:RightLeg",
            };
            Transform[] transforms = controller.GetComponentsInChildren<Transform>(true);
            Quaternion[] before = stableBoneNames
                .Select(name => transforms.Single(transform => transform.name == name).localRotation)
                .ToArray();
            Transform leftArm = transforms.Single(transform => transform.name == "mixamorig:LeftArm");
            Quaternion leftArmBefore = leftArm.localRotation;

            animator.SetBool(PrototypePlayerAnimationDriver.AimingHash, true);
            animator.Play("BusterAim", busterLayer, 0f);
            animator.SetLayerWeight(busterLayer, 1f);
            animator.Update(0f);
            driver.AlignBusterWithGameplayForward();

            for (int index = 0; index < stableBoneNames.Length; index += 1)
            {
                Transform bone = transforms.Single(transform => transform.name == stableBoneNames[index]);
                Assert.That(Quaternion.Angle(before[index], bone.localRotation), Is.LessThan(0.05f),
                    $"Buster Aim changed the Action Idle body bone {stableBoneNames[index]}.");
            }
            Assert.That(Quaternion.Angle(leftArmBefore, leftArm.localRotation), Is.GreaterThan(5f),
                "The left Buster arm did not enter its aiming pose.");
            Transform leftForeArm = transforms.Single(
                transform => transform.name == "mixamorig:LeftForeArm");
            Vector3 upperArmDirection = (leftForeArm.position - leftArm.position).normalized;
            Assert.That(Vector3.Dot(upperArmDirection, controller.transform.forward), Is.GreaterThan(0.9999f),
                "The upper arm did not extend straight along the forward shot vector.");
            Transform muzzle = transforms.Single(transform => transform.name == "BusterMuzzle");
            Assert.That(Vector3.Dot(muzzle.forward, controller.transform.forward), Is.GreaterThan(0.9999f));
            Assert.That(Mathf.Abs(Vector3.Dot(muzzle.forward, controller.transform.up)), Is.LessThan(0.001f));
            Vector3 busterSpan = (muzzle.position - leftForeArm.position).normalized;
            Assert.That(Vector3.Dot(busterSpan, controller.transform.forward), Is.GreaterThan(0.98f),
                "The Buster geometry did not continue forward from the straight upper arm.");

            Vector3 lockedTargetDirection = (
                controller.transform.forward * 0.82f
                - controller.transform.right * 0.24f
                + controller.transform.up * 0.38f).normalized;
            driver.AlignBusterWithWorldDirection(lockedTargetDirection);
            upperArmDirection = (leftForeArm.position - leftArm.position).normalized;
            Assert.That(Vector3.Dot(upperArmDirection, lockedTargetDirection), Is.GreaterThan(0.9999f),
                "The straight upper arm did not follow the locked target direction.");
            Assert.That(Vector3.Dot(muzzle.forward, lockedTargetDirection), Is.GreaterThan(0.9999f),
                "The visible Buster barrel did not follow the locked target direction.");
            busterSpan = (muzzle.position - leftForeArm.position).normalized;
            Assert.That(Vector3.Dot(busterSpan, lockedTargetDirection), Is.GreaterThan(0.98f),
                "The Buster geometry bent away from the locked-target arm line.");

            Quaternion solvedShoulder = leftArm.rotation;
            Quaternion solvedForeArm = leftForeArm.rotation;
            for (int index = 0; index < 30; index += 1)
            {
                driver.AlignBusterWithWorldDirection(lockedTargetDirection);
            }
            Assert.That(Quaternion.Angle(solvedShoulder, leftArm.rotation), Is.LessThan(0.05f),
                "Repeated aim updates accumulated on the shoulder and made the Buster fly around.");
            Assert.That(Quaternion.Angle(solvedForeArm, leftForeArm.rotation), Is.LessThan(0.05f),
                "Repeated aim updates accumulated on the forearm and made the Buster fly around.");
            Assert.That(Vector3.Dot(muzzle.forward, lockedTargetDirection), Is.GreaterThan(0.9999f));

            animator.speed = 1f;
            driver.SetBusterAimDirection(lockedTargetDirection);
            driver.SetAiming(true);
            yield return new WaitForEndOfFrame();

            upperArmDirection = (leftForeArm.position - leftArm.position).normalized;
            busterSpan = (muzzle.position - leftForeArm.position).normalized;
            Assert.That(Vector3.Dot(upperArmDirection, lockedTargetDirection), Is.GreaterThan(0.9999f),
                "The post-Animator pass did not keep the upper arm straight at the locked target.");
            Assert.That(Vector3.Dot(busterSpan, lockedTargetDirection), Is.GreaterThan(0.98f),
                "The post-Animator pass did not keep the Buster on the locked-target arm line.");
            Assert.That(Vector3.Dot(muzzle.forward, lockedTargetDirection), Is.GreaterThan(0.9999f),
                "The post-Animator barrel direction drifted away from the locked target.");
        }

        private static bool IsCurrentOrNext(Animator animator, string stateName)
        {
            return animator.GetCurrentAnimatorStateInfo(0).IsName(stateName)
                   || (animator.IsInTransition(0)
                       && animator.GetNextAnimatorStateInfo(0).IsName(stateName));
        }

        private static float CurrentClipWeight(Animator animator, string clipName)
        {
            return animator.GetCurrentAnimatorClipInfo(0)
                .Where(info => info.clip.name == clipName)
                .Sum(info => info.weight);
        }

        private static float HorizontalDistance(Vector3 first, Vector3 second)
        {
            return Vector2.Distance(
                new Vector2(first.x, first.z),
                new Vector2(second.x, second.z));
        }

        private static string DescribeAnimator(Animator animator)
        {
            AnimatorStateInfo current = animator.GetCurrentAnimatorStateInfo(0);
            AnimatorStateInfo next = animator.GetNextAnimatorStateInfo(0);
            return $"current={current.shortNameHash}, next={next.shortNameHash}, "
                   + $"transition={animator.IsInTransition(0)}, "
                   + $"grounded={animator.GetBool(PrototypePlayerAnimationDriver.GroundedHash)}, "
                   + $"vertical={animator.GetFloat(PrototypePlayerAnimationDriver.VerticalSpeedHash):F3}, "
                   + $"timeScale={Time.timeScale:F3}.";
        }
    }
}
