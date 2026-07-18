using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.TestTools;

namespace RuinCrawler.Production.Tests
{
    public sealed class ProductionTankControlsPlayModeTests
    {
        private readonly List<Object> createdObjects = new List<Object>();
        private readonly List<InputDevice> createdDevices = new List<InputDevice>();

        [UnityTest]
        public IEnumerator ForwardAndReverseMoveOnlyAlongBodyFacing()
        {
            CreateRig("TankThrottle", out ProductionPlayerController player, out _, out Gamepad gamepad);
            player.transform.rotation = Quaternion.Euler(0f, 37f, 0f);
            Vector3 bodyForward = player.transform.forward;
            Vector3 bodyRight = player.transform.right;

            Vector3 forwardStart = player.transform.position;
            SetStick(gamepad, new Vector2(0f, 1f));
            yield return WaitForSeconds(0.16f);
            SetStick(gamepad, Vector2.zero);
            Vector3 forwardTravel = Vector3.ProjectOnPlane(
                player.transform.position - forwardStart,
                Vector3.up);

            Assert.That(Vector3.Dot(forwardTravel, bodyForward), Is.GreaterThan(0.35f));
            Assert.That(Mathf.Abs(Vector3.Dot(forwardTravel, bodyRight)), Is.LessThan(0.08f),
                "W produced camera-relative lateral movement instead of body-forward throttle.");

            Vector3 reverseStart = player.transform.position;
            SetStick(gamepad, new Vector2(0f, -1f));
            yield return WaitForSeconds(0.16f);
            SetStick(gamepad, Vector2.zero);
            Vector3 reverseTravel = Vector3.ProjectOnPlane(
                player.transform.position - reverseStart,
                Vector3.up);

            Assert.That(Vector3.Dot(reverseTravel, bodyForward), Is.LessThan(-0.35f));
            Assert.That(Mathf.Abs(Vector3.Dot(reverseTravel, bodyRight)), Is.LessThan(0.08f),
                "S produced camera-relative lateral movement instead of body-backward throttle.");
        }

        [UnityTest]
        public IEnumerator LateralInputTurnsInPlaceAndCameraSettlesBehindBody()
        {
            CreateRig("TankTurn", out ProductionPlayerController player, out Camera camera, out Gamepad gamepad);
            Vector3 startPosition = player.transform.position;
            float startYaw = player.transform.eulerAngles.y;

            SetStick(gamepad, new Vector2(1f, 0f));
            yield return WaitForSeconds(0.24f);
            SetStick(gamepad, Vector2.zero);

            float yawDelta = Mathf.DeltaAngle(startYaw, player.transform.eulerAngles.y);
            Vector3 flatTravel = Vector3.ProjectOnPlane(player.transform.position - startPosition, Vector3.up);
            Assert.That(yawDelta, Is.GreaterThan(20f), "D did not turn Mega Man to his right.");
            Assert.That(flatTravel.magnitude, Is.LessThan(0.08f),
                "D strafed the player instead of turning the tank-control body in place.");

            yield return WaitForSeconds(0.8f);
            Vector3 cameraOffset = Vector3.ProjectOnPlane(
                camera.transform.position - player.transform.position,
                Vector3.up).normalized;
            Assert.That(Vector3.Dot(cameraOffset, -player.transform.forward), Is.GreaterThan(0.97f),
                "The camera did not return behind Mega Man after a tank turn.");

            float rightTurnYaw = player.transform.eulerAngles.y;
            SetStick(gamepad, new Vector2(-1f, 0f));
            yield return WaitForSeconds(0.24f);
            SetStick(gamepad, Vector2.zero);
            Assert.That(Mathf.DeltaAngle(rightTurnYaw, player.transform.eulerAngles.y), Is.LessThan(-20f),
                "A did not turn Mega Man to his left.");
        }

        [UnityTest]
        public IEnumerator ForwardPlusTurnFollowsCurvedBodyHeadingWithoutStrafe()
        {
            CreateRig("TankArc", out ProductionPlayerController player, out _, out Gamepad gamepad);
            Vector3 startPosition = player.transform.position;
            float startYaw = player.transform.eulerAngles.y;

            SetStick(gamepad, Vector2.one);
            yield return WaitForSeconds(0.22f);
            SetStick(gamepad, Vector2.zero);

            Vector3 travel = Vector3.ProjectOnPlane(player.transform.position - startPosition, Vector3.up);
            float endYaw = player.transform.eulerAngles.y;
            Vector3 averageHeading = Quaternion.Euler(
                0f,
                startYaw + Mathf.DeltaAngle(startYaw, endYaw) * 0.5f,
                0f) * Vector3.forward;

            Assert.That(Mathf.DeltaAngle(startYaw, endYaw), Is.GreaterThan(20f));
            Assert.That(Vector3.Dot(travel.normalized, averageHeading), Is.GreaterThan(0.94f),
                "W+D should trace a forward turning arc, not a camera-relative diagonal strafe.");
        }

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            for (int index = 0; index < createdDevices.Count; index += 1)
            {
                if (createdDevices[index] != null && createdDevices[index].added)
                {
                    InputSystem.RemoveDevice(createdDevices[index]);
                }
            }

            for (int index = 0; index < createdObjects.Count; index += 1)
            {
                if (createdObjects[index] != null)
                {
                    Object.Destroy(createdObjects[index]);
                }
            }

            createdDevices.Clear();
            createdObjects.Clear();
            yield return null;
        }

        private void CreateRig(
            string name,
            out ProductionPlayerController player,
            out Camera camera,
            out Gamepad gamepad)
        {
            float offset = 650f + createdObjects.Count * 30f;
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ground.name = name + "_Ground";
            ground.transform.SetPositionAndRotation(new Vector3(offset, -0.1f, offset), Quaternion.identity);
            ground.transform.localScale = new Vector3(24f, 0.2f, 24f);
            createdObjects.Add(ground);

            GameObject playerObject = new GameObject(name + "_Player");
            playerObject.transform.SetPositionAndRotation(new Vector3(offset, 0.01f, offset), Quaternion.identity);
            CharacterController character = playerObject.AddComponent<CharacterController>();
            character.height = 2f;
            character.radius = 0.45f;
            character.center = Vector3.up;
            player = playerObject.AddComponent<ProductionPlayerController>();
            createdObjects.Add(playerObject);

            GameObject cameraObject = new GameObject(name + "_Camera");
            cameraObject.transform.SetPositionAndRotation(
                playerObject.transform.position + new Vector3(0f, 3f, -6.8f),
                Quaternion.LookRotation(Vector3.forward, Vector3.up));
            camera = cameraObject.AddComponent<Camera>();
            ProductionFollowCamera follow = cameraObject.AddComponent<ProductionFollowCamera>();
            createdObjects.Add(cameraObject);

            InputActionAsset actions = ScriptableObject.CreateInstance<InputActionAsset>();
            actions.name = name + "_Input";
            InputActionMap gameplay = new InputActionMap("Gameplay");
            gameplay.AddAction("Move", InputActionType.Value, "<Gamepad>/leftStick");
            actions.AddActionMap(gameplay);
            createdObjects.Add(actions);

            follow.Configure(playerObject.transform, null, actions);
            player.Configure(actions, camera, playerObject.transform, null, null, null, null, null);
            gamepad = InputSystem.AddDevice<Gamepad>();
            createdDevices.Add(gamepad);
            Physics.SyncTransforms();
        }

        private static void SetStick(Gamepad gamepad, Vector2 value)
        {
            InputSystem.QueueStateEvent(gamepad, new GamepadState { leftStick = value });
            InputSystem.Update();
        }

        private static IEnumerator WaitForSeconds(float duration)
        {
            float elapsed = 0f;
            while (elapsed < duration)
            {
                yield return null;
                elapsed += Time.deltaTime;
            }
        }
    }
}
