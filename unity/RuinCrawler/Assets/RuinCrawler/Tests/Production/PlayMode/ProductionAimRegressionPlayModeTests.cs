using System.Collections;
using System.Reflection;
using NUnit.Framework;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Production.Tests
{
    public sealed class ProductionAimRegressionPlayModeTests
    {
        private static readonly FieldInfo ManualAimHeldField = typeof(LockOnController).GetField(
            "manualAimHeld",
            BindingFlags.Instance | BindingFlags.NonPublic);

        private static readonly FieldInfo CameraYawField = typeof(ProductionFollowCamera).GetField(
            "yaw",
            BindingFlags.Instance | BindingFlags.NonPublic);

        [UnityTest]
        public IEnumerator ManualAimPressAndYawDisturbanceKeepCameraBehindPlayer()
        {
            var player = new GameObject("AimCamera_Player");
            player.transform.SetPositionAndRotation(new Vector3(500f, 30f, 500f), Quaternion.identity);
            LockOnController lockOn = player.AddComponent<LockOnController>();

            var cameraObject = new GameObject("AimCamera_Camera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.transform.SetPositionAndRotation(
                player.transform.position + new Vector3(-6f, 3f, 0f),
                Quaternion.LookRotation(player.transform.position + Vector3.up - cameraObject.transform.position));
            ProductionFollowCamera follow = cameraObject.AddComponent<ProductionFollowCamera>();
            lockOn.Configure(null, camera);
            follow.Configure(player.transform, lockOn, null);
            CameraYawField.SetValue(follow, 90f);
            SetManualAim(lockOn, true);

            float elapsed = 0f;
            do
            {
                yield return null;
                elapsed += Time.deltaTime;
            }
            while (follow.IsAimRecentering && elapsed < 1f);

            Assert.That(elapsed, Is.LessThan(1f), "The source-parity 0.42-second camera swing never completed.");
            Assert.That(elapsed, Is.LessThanOrEqualTo(0.5f),
                "The camera recenter exceeded the source 0.42-second window plus frame tolerance.");
            Assert.That(Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)), Is.LessThan(1f));
            Vector3 cameraOffset = Vector3.ProjectOnPlane(
                camera.transform.position - player.transform.position,
                Vector3.up).normalized;
            Assert.That(Vector3.Dot(cameraOffset, -player.transform.forward), Is.GreaterThan(0.95f));

            CameraYawField.SetValue(follow, 48f);
            yield return null;
            Assert.That(Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)),
                Is.LessThan(48f),
                "A yaw disturbance must immediately begin returning behind Mega Man instead of becoming a free orbit.");

            elapsed = 0f;
            do
            {
                yield return null;
                elapsed += Time.deltaTime;
            }
            while (Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)) > 1f
                   && elapsed < 1.5f);

            Assert.That(Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)),
                Is.LessThan(1f),
                "The gameplay camera did not settle behind Mega Man's back.");

            Object.Destroy(cameraObject);
            Object.Destroy(player);
            yield return null;
        }

        [UnityTest]
        public IEnumerator ManualAimRayIgnoresPlayerBodyWithoutDraggingBodyTowardDetachedCameraYaw()
        {
            var playerObject = new GameObject("AimRay_Player");
            playerObject.layer = LayerMask.NameToLayer("Player");
            playerObject.transform.position = new Vector3(500f, 30f, 500f);
            CharacterController character = playerObject.AddComponent<CharacterController>();
            character.height = 2f;
            character.radius = 0.5f;
            character.center = Vector3.up;
            LockOnController lockOn = playerObject.AddComponent<LockOnController>();
            ProductionPlayerController player = playerObject.AddComponent<ProductionPlayerController>();

            var muzzleObject = new GameObject("AimRay_Muzzle");
            muzzleObject.transform.SetParent(playerObject.transform, false);
            muzzleObject.transform.localPosition = new Vector3(0.3f, 1.1f, 0.35f);

            var cameraObject = new GameObject("AimRay_Camera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.transform.SetPositionAndRotation(
                playerObject.transform.position + new Vector3(0f, 1.1f, -4f),
                Quaternion.LookRotation(Vector3.forward, Vector3.up));
            ProductionFollowCamera follow = cameraObject.AddComponent<ProductionFollowCamera>();
            lockOn.Configure(null, camera);
            player.Configure(null, camera, muzzleObject.transform, null, lockOn, null, null, null);
            follow.Configure(playerObject.transform, lockOn, null);
            SetManualAim(lockOn, true);

            GameObject target = GameObject.CreatePrimitive(PrimitiveType.Cube);
            target.name = "AimRay_WorldTarget";
            target.layer = LayerMask.NameToLayer("WorldGeometry");
            target.transform.SetPositionAndRotation(
                playerObject.transform.position + new Vector3(0f, 1.1f, 8f),
                Quaternion.identity);
            target.transform.localScale = new Vector3(3f, 3f, 0.5f);
            Physics.SyncTransforms();

            Vector3 direction = player.ResolveAimDirection(muzzleObject.transform.position);
            Assert.That(Vector3.Dot(direction, Vector3.forward), Is.GreaterThan(0.98f),
                "The reticle ray hit Mega Man's own collider and turned the Buster back toward his torso.");

            CameraYawField.SetValue(follow, 90f);
            float facingElapsed = 0f;
            do
            {
                yield return null;
                facingElapsed += Time.deltaTime;
            }
            while (Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)) > 1f
                   && facingElapsed < 0.75f);

            Assert.That(Vector3.Dot(player.transform.forward, Vector3.forward), Is.GreaterThan(0.999f),
                "A detached camera yaw must not whip Mega Man's tank-control body around.");
            Assert.That(Mathf.Abs(Mathf.DeltaAngle(follow.OrbitYaw, player.transform.eulerAngles.y)),
                Is.LessThan(1f),
                "Manual aim must return the camera behind Mega Man's body facing.");

            Object.Destroy(target);
            Object.Destroy(cameraObject);
            Object.Destroy(playerObject);
            yield return null;
        }

        private static void SetManualAim(LockOnController controller, bool value)
        {
            Assert.That(ManualAimHeldField, Is.Not.Null);
            ManualAimHeldField.SetValue(controller, value);
        }
    }
}
