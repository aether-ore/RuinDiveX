using System;
using System.Collections;
using System.Collections.Generic;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Persistence;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.Runtime.Player
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class ProductionPlayerController : MonoBehaviour
    {
        [SerializeField] private InputActionAsset inputActions;
        [SerializeField] private Camera gameplayCamera;
        [SerializeField] private Transform muzzle;
        [SerializeField] private MonoBehaviour weaponBehaviour;
        [SerializeField] private LockOnController lockOn;
        [SerializeField] private HealthComponent vitality;
        [SerializeField] private PrototypePlayerAnimationDriver animationDriver;
        [SerializeField] private PrototypeBusterVisual busterVisual;
        [SerializeField] private float walkSpeed = SourceGameplayContract.PlayerWalkSpeed;
        [SerializeField] private float jogSpeed = SourceGameplayContract.PlayerJogSpeed;
        [SerializeField] private float sprintSpeed = SourceGameplayContract.PlayerSprintSpeed;
        [SerializeField] private float rotationResponse = 14f;
        [SerializeField] private float tankTurnRateRadians = SourceGameplayContract.PlayerTankTurnRateRadians;
        [SerializeField] private float dodgeSpeed = 8.5f;
        [SerializeField] private float dodgeDuration = 0.22f;
        [SerializeField] private float dodgeCooldown = 0.32f;
        [SerializeField] private LayerMask aimCollisionMask = Physics.DefaultRaycastLayers;
        [SerializeField, Min(0f)] private float defeatReturnDelay = 1.25f;

        private const float ManualAimDistance = 100f;
        private const int AimHitCapacity = 32;

        private CharacterController characterController;
        private InputAction moveAction;
        private InputAction jumpAction;
        private InputAction dodgeAction;
        private InputAction fireAction;
        private IPlayerWeapon weapon;
        private float verticalVelocity;
        private float dodgeRemaining;
        private float dodgeCooldownRemaining;
        private Vector3 dodgeDirection;
        private readonly RaycastHit[] aimHits = new RaycastHit[AimHitCapacity];
        private Vector3 lastAimDirection;
        private float tankTurnInput;
        private bool gameplayEnabled = true;
        private readonly HashSet<string> gameplayLocks = new HashSet<string>(StringComparer.Ordinal);
        private Coroutine defeatReturnRoutine;
        private PlayerTraversalMediumSensor traversalMediumSensor;
        private TraversalProfileV2 capturedAirProfile;
        private BallisticStateV2 ballisticState;
        private Vector3 airHorizontalVelocity;
        private bool airborne;
        private bool wasFlooded;

        public HealthComponent Vitality => vitality;
        public LockOnController LockOn => lockOn;
        public IPlayerWeapon Weapon => weapon;
        public Vector3 LastAimDirection => lastAimDirection.sqrMagnitude > 0.000001f
            ? lastAimDirection
            : transform.forward;
        public float TankTurnInput => tankTurnInput;
        public bool IsTankTurning => Mathf.Abs(tankTurnInput) > 0.05f;
        public bool IsAirborne => airborne;
        public bool IsFlooded => traversalMediumSensor != null && traversalMediumSensor.IsFlooded;
        public bool GameplayEnabled => gameplayEnabled;
        public string CurrentTraversalProfileId => (capturedAirProfile ?? ResolveGroundProfile()).Id;

        public void Configure(
            InputActionAsset actions,
            Camera targetCamera,
            Transform projectileMuzzle,
            MonoBehaviour playerWeapon,
            LockOnController lockController,
            HealthComponent playerVitality,
            PrototypePlayerAnimationDriver playerAnimation,
            PrototypeBusterVisual equippedBuster)
        {
            UnbindInput();
            inputActions = actions;
            gameplayCamera = targetCamera;
            muzzle = projectileMuzzle;
            weaponBehaviour = playerWeapon;
            weapon = playerWeapon as IPlayerWeapon;
            lockOn = lockController;
            vitality = playerVitality;
            animationDriver = playerAnimation;
            busterVisual = equippedBuster;
            BindInput();
        }

        public void SetGameplayEnabled(bool value)
        {
            SetGameplayLock("gameplay-enabled-api", !value);
        }

        /// <summary>
        /// Adds or removes a named gameplay lock. Named locks prevent a water
        /// transfer, pause menu, or workshop from accidentally re-enabling
        /// input while another system still owns player control.
        /// </summary>
        public void SetGameplayLock(string ownerId, bool locked)
        {
            if (string.IsNullOrWhiteSpace(ownerId))
            {
                throw new ArgumentException("A stable gameplay-lock owner ID is required.", nameof(ownerId));
            }

            if (locked) gameplayLocks.Add(ownerId.Trim());
            else gameplayLocks.Remove(ownerId.Trim());
            gameplayEnabled = gameplayLocks.Count == 0;
            if (gameplayEnabled)
            {
                inputActions?.FindActionMap("Gameplay", false)?.Enable();
            }
            else
            {
                inputActions?.FindActionMap("Gameplay", false)?.Disable();
            }
        }

        private void Awake()
        {
            if (GetComponent<PlayerEnvironmentalProtection>() == null)
            {
                gameObject.AddComponent<PlayerEnvironmentalProtection>();
            }

            traversalMediumSensor = GetComponent<PlayerTraversalMediumSensor>();
            if (traversalMediumSensor == null)
            {
                traversalMediumSensor = gameObject.AddComponent<PlayerTraversalMediumSensor>();
            }

            characterController = GetComponent<CharacterController>();
            weapon = weaponBehaviour as IPlayerWeapon;
            if (vitality == null)
            {
                vitality = GetComponent<HealthComponent>();
            }

            if (lockOn == null)
            {
                lockOn = GetComponent<LockOnController>();
            }

            if (gameplayCamera == null)
            {
                gameplayCamera = Camera.main;
            }

            if (muzzle == null && animationDriver != null)
            {
                muzzle = animationDriver.BusterMuzzle;
            }

            if (vitality != null)
            {
                vitality.Died += HandleDeath;
            }
        }

        private void OnEnable()
        {
            BindInput();
        }

        private void OnDisable()
        {
            UnbindInput();
        }

        private void OnDestroy()
        {
            if (vitality != null)
            {
                vitality.Died -= HandleDeath;
            }
        }

        private void Update()
        {
            if (!gameplayEnabled || vitality != null && vitality.IsDead)
            {
                tankTurnInput = 0f;
                return;
            }

            UpdateMovement();
            UpdateWeapon();
        }

        private void BindInput()
        {
            if (!isActiveAndEnabled || inputActions == null || moveAction != null)
            {
                return;
            }

            moveAction = inputActions.FindAction("Gameplay/Move", false);
            jumpAction = inputActions.FindAction("Gameplay/Jump", false);
            dodgeAction = inputActions.FindAction("Gameplay/Dodge", false);
            fireAction = inputActions.FindAction("Gameplay/Fire", false);
            inputActions.FindActionMap("Gameplay", false)?.Enable();
        }

        private void UnbindInput()
        {
            moveAction = null;
            jumpAction = null;
            dodgeAction = null;
            fireAction = null;
        }

        private void UpdateMovement()
        {
            Vector2 input = moveAction?.ReadValue<Vector2>() ?? Vector2.zero;
            Camera activeCamera = gameplayCamera != null ? gameplayCamera : Camera.main;
            bool movementLocked = lockOn != null
                                  && lockOn.MovementLocked
                                  && lockOn.CurrentTarget != null;

            Vector3 movement;
            if (movementLocked)
            {
                // Preserve the established lock-on contract: the body owns
                // target facing while the stick supplies target-relative
                // forward/back and strafe movement.
                Vector3 movementForward = activeCamera != null
                    ? Vector3.ProjectOnPlane(activeCamera.transform.forward, Vector3.up).normalized
                    : transform.forward;
                Vector3 movementRight = activeCamera != null
                    ? Vector3.ProjectOnPlane(activeCamera.transform.right, Vector3.up).normalized
                    : transform.right;
                movement = movementForward * input.y + movementRight * input.x;
                tankTurnInput = 0f;
            }
            else
            {
                // Mega Man Legends-style tank controls: horizontal input owns
                // body yaw and vertical input is a throttle along body facing.
                // No camera-relative lateral velocity is produced here.
                tankTurnInput = Mathf.Clamp(input.x, -1f, 1f);
                if (Mathf.Abs(tankTurnInput) > 0.001f)
                {
                    transform.Rotate(
                        0f,
                        tankTurnInput * tankTurnRateRadians * Mathf.Rad2Deg * Time.deltaTime,
                        0f,
                        Space.World);
                }

                movement = transform.forward * Mathf.Clamp(input.y, -1f, 1f);
            }

            movement = Vector3.ClampMagnitude(movement, 1f);
            bool groundedBeforeMove = characterController.isGrounded;
            dodgeCooldownRemaining = Mathf.Max(0f, dodgeCooldownRemaining - Time.deltaTime);
            if (groundedBeforeMove
                && dodgeRemaining <= 0f
                && dodgeCooldownRemaining <= 0f
                && dodgeAction?.WasPressedThisFrame() == true)
            {
                dodgeDirection = movement.sqrMagnitude > 0.001f ? movement.normalized : transform.forward;
                dodgeRemaining = dodgeDuration;
                dodgeCooldownRemaining = dodgeCooldown;
                animationDriver?.NotifyCombatActivity();
            }

            Vector3 desiredFacing = Vector3.zero;
            if (movementLocked)
            {
                desiredFacing = Vector3.ProjectOnPlane(
                    lockOn.CurrentTarget.AimTransform.position - transform.position,
                    Vector3.up).normalized;
            }

            if (desiredFacing.sqrMagnitude > 0.001f)
            {
                Quaternion targetRotation = Quaternion.LookRotation(desiredFacing, Vector3.up);
                transform.rotation = Quaternion.Slerp(
                    transform.rotation,
                    targetRotation,
                    1f - Mathf.Exp(-rotationResponse * Time.deltaTime));
            }

            bool sprinting = Keyboard.current?.leftShiftKey.isPressed == true && input.y > 0.35f;
            float speed = sprinting ? sprintSpeed : movement.sqrMagnitude < 0.18f ? walkSpeed : jogSpeed;
            TraversalProfileV2 groundProfile = ResolveGroundProfile();
            bool floodedBeforeMove = traversalMediumSensor != null && traversalMediumSensor.IsFlooded;
            speed *= (float)groundProfile.GroundSpeedMultiplier;

            if (groundedBeforeMove && airborne && verticalVelocity <= 0f)
            {
                EndAirborneMotion();
            }

            bool beganAirborneThisFrame = false;
            if (!airborne && groundedBeforeMove && jumpAction?.WasPressedThisFrame() == true)
            {
                BeginAirborneMotion(groundProfile, groundProfile.TakeoffVelocity, BallisticPhaseV2.Rising);
                beganAirborneThisFrame = true;
            }
            else if (!airborne && !groundedBeforeMove)
            {
                BeginAirborneMotion(groundProfile, Mathf.Min(0f, verticalVelocity), BallisticPhaseV2.Falling);
                beganAirborneThisFrame = true;
            }

            if (airborne && floodedBeforeMove && !wasFlooded)
            {
                ApplyDeepWaterEntryResponse();
            }

            Vector3 horizontalVelocity;
            if (dodgeRemaining > 0f)
            {
                dodgeRemaining = Mathf.Max(0f, dodgeRemaining - Time.deltaTime);
                horizontalVelocity = dodgeDirection * dodgeSpeed;
            }
            else if (airborne)
            {
                TraversalProfileV2 profile = capturedAirProfile ?? groundProfile;
                Vector3 desiredAirVelocity = movement * (float)profile.HorizontalSpeedCap;
                if (beganAirborneThisFrame)
                {
                    airHorizontalVelocity = Vector3.ClampMagnitude(
                        movement * speed,
                        (float)profile.HorizontalSpeedCap);
                }

                float acceleration = (float)profile.AirAcceleration;
                if (airHorizontalVelocity.sqrMagnitude > 0.0001f
                    && desiredAirVelocity.sqrMagnitude > 0.0001f
                    && Vector3.Dot(airHorizontalVelocity, desiredAirVelocity) < 0f)
                {
                    acceleration *= (float)profile.OpposingInputAccelerationMultiplier;
                }

                airHorizontalVelocity = Vector3.MoveTowards(
                    airHorizontalVelocity,
                    desiredAirVelocity,
                    acceleration * Time.deltaTime);
                horizontalVelocity = Vector3.ClampMagnitude(
                    airHorizontalVelocity,
                    (float)profile.HorizontalSpeedCap);
            }
            else
            {
                horizontalVelocity = movement * speed;
            }

            CollisionFlags flags;
            if (airborne)
            {
                BallisticStepResultV2 step = BallisticKernelV2.Advance(
                    capturedAirProfile,
                    ballisticState,
                    Time.deltaTime);
                ballisticState = step.State;
                flags = SweepBallisticSegments(step, horizontalVelocity, floodedBeforeMove);
            }
            else
            {
                verticalVelocity = -2f;
                flags = characterController.Move(
                    horizontalVelocity * Time.deltaTime
                    + Vector3.up * (verticalVelocity * Time.deltaTime));
            }

            bool groundedAfterMove = characterController.isGrounded || (flags & CollisionFlags.Below) != 0;
            if (airborne && (flags & CollisionFlags.Above) != 0 && verticalVelocity > 0f)
            {
                ballisticState = new BallisticStateV2(
                    ballisticState.ElapsedTime,
                    transform.position.y,
                    0d,
                    BallisticPhaseV2.Falling);
                verticalVelocity = 0f;
            }
            else if (airborne)
            {
                ballisticState = new BallisticStateV2(
                    ballisticState.ElapsedTime,
                    transform.position.y,
                    ballisticState.VerticalVelocity,
                    ballisticState.Phase);
            }

            bool floodedAfterMove = traversalMediumSensor != null && traversalMediumSensor.IsFlooded;
            if (airborne && floodedAfterMove && !floodedBeforeMove)
            {
                ApplyDeepWaterEntryResponse();
            }

            if (groundedAfterMove && verticalVelocity <= 0f)
            {
                EndAirborneMotion();
            }

            wasFlooded = floodedAfterMove;

            animationDriver?.ApplyMotion(
                characterController.velocity,
                groundedAfterMove,
                verticalVelocity,
                Time.deltaTime);
            animationDriver?.SetCombatEngaged(lockOn != null && lockOn.CurrentTarget != null);
        }

        /// <summary>
        /// Applies every closed-form ballistic segment through CharacterController.
        /// A frame that crosses the apex therefore performs a rising sweep followed
        /// by a falling sweep instead of tunnelling through a ceiling or ledge with
        /// one net displacement. Horizontal travel is apportioned by exact segment
        /// duration so one large step follows the same path as subdivided updates.
        /// </summary>
        private CollisionFlags SweepBallisticSegments(
            BallisticStepResultV2 step,
            Vector3 horizontalVelocity,
            bool flooded)
        {
            CollisionFlags combined = CollisionFlags.None;
            double actualVelocity = step.State.VerticalVelocity;
            foreach (BallisticSweepSegmentV2 segment in step.Segments)
            {
                float segmentDuration = (float)segment.Duration;
                float verticalDisplacement = (float)(segment.EndPosition - segment.StartPosition);
                if (flooded && segment.Phase == BallisticPhaseV2.Falling)
                {
                    verticalDisplacement = Mathf.Max(
                        verticalDisplacement,
                        (float)(-WaterEntryResponseV2.IndustrialFactory.SubmergedTerminalDescentSpeed
                            * segment.Duration));
                    actualVelocity = WaterEntryResponseV2.IndustrialFactory
                        .ClampSubmergedVerticalVelocity(segment.EndVelocity);
                }

                CollisionFlags segmentFlags = characterController.Move(
                    horizontalVelocity * segmentDuration
                    + Vector3.up * verticalDisplacement);
                combined |= segmentFlags;
                if ((segmentFlags & CollisionFlags.Above) != 0
                    && segment.Phase == BallisticPhaseV2.Rising)
                {
                    actualVelocity = 0d;
                    break;
                }

                if ((segmentFlags & CollisionFlags.Below) != 0
                    && segment.Phase == BallisticPhaseV2.Falling)
                {
                    break;
                }
            }

            BallisticPhaseV2 phase = actualVelocity > 0d
                ? BallisticPhaseV2.Rising
                : BallisticPhaseV2.Falling;
            ballisticState = new BallisticStateV2(
                step.State.ElapsedTime,
                transform.position.y,
                actualVelocity,
                phase);
            verticalVelocity = (float)actualVelocity;
            return combined;
        }

        private TraversalProfileV2 ResolveGroundProfile()
        {
            return traversalMediumSensor != null && traversalMediumSensor.IsFlooded
                ? TraversalProfilesV2.Flooded
                : TraversalProfilesV2.Dry;
        }

        private void BeginAirborneMotion(
            TraversalProfileV2 profile,
            double initialVelocity,
            BallisticPhaseV2 phase)
        {
            capturedAirProfile = profile ?? TraversalProfilesV2.Dry;
            ballisticState = phase == BallisticPhaseV2.Rising
                ? BallisticKernelV2.CreateTakeoffState(capturedAirProfile, transform.position.y)
                : new BallisticStateV2(0d, transform.position.y, Math.Min(0d, initialVelocity), phase);
            verticalVelocity = (float)ballisticState.VerticalVelocity;
            airborne = true;
        }

        private void ApplyDeepWaterEntryResponse()
        {
            if (!airborne || ballisticState.VerticalVelocity >= 0d || traversalMediumSensor == null)
            {
                return;
            }

            double resolved = WaterEntryResponseV2.IndustrialFactory.ResolveEntryVerticalVelocity(
                ballisticState.VerticalVelocity,
                traversalMediumSensor.CurrentWaterDepth);
            resolved = WaterEntryResponseV2.IndustrialFactory.ClampSubmergedVerticalVelocity(resolved);
            ballisticState = new BallisticStateV2(
                ballisticState.ElapsedTime,
                transform.position.y,
                resolved,
                BallisticPhaseV2.Falling);
            verticalVelocity = (float)resolved;
            airHorizontalVelocity = Vector3.ClampMagnitude(
                airHorizontalVelocity,
                (float)TraversalProfilesV2.Flooded.HorizontalSpeedCap);
        }

        private void EndAirborneMotion()
        {
            airborne = false;
            capturedAirProfile = null;
            airHorizontalVelocity = Vector3.zero;
            verticalVelocity = -2f;
        }

        private void UpdateWeapon()
        {
            bool wantsAim = lockOn != null && (lockOn.ManualAimHeld || lockOn.CurrentTarget != null);
            bool wantsFire = fireAction?.IsPressed() == true;
            bool presentsBusterAim = wantsAim || wantsFire;
            animationDriver?.SetAiming(presentsBusterAim);

            Transform source = muzzle != null ? muzzle : transform;
            if (presentsBusterAim)
            {
                lastAimDirection = ResolveAimDirection(source.position);
                busterVisual?.SetEquipped(true);
                animationDriver?.SetBusterAimDirection(lastAimDirection);
            }

            if (!wantsFire || weapon == null)
            {
                return;
            }

            if (weapon.TryFire(source.position, LastAimDirection))
            {
                animationDriver?.NotifyShotFired();
            }
        }

        public Vector3 ResolveAimDirection(Vector3 origin)
        {
            if (lockOn != null && lockOn.ManualAimHeld && gameplayCamera != null)
            {
                Ray ray = gameplayCamera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f));
                int hitCount = Physics.RaycastNonAlloc(
                    ray,
                    aimHits,
                    ManualAimDistance,
                    aimCollisionMask,
                    QueryTriggerInteraction.Ignore);
                RaycastHit? nearestValidHit = null;
                for (int index = 0; index < hitCount; index += 1)
                {
                    RaycastHit candidate = aimHits[index];
                    if (candidate.collider == null || IsOwnAimCollider(candidate.collider))
                    {
                        continue;
                    }

                    int candidateLayer = candidate.collider.gameObject.layer;
                    if (candidateLayer == LayerMask.NameToLayer("Player")
                        || candidateLayer == LayerMask.NameToLayer("PlayerProjectile"))
                    {
                        continue;
                    }

                    if (!nearestValidHit.HasValue || candidate.distance < nearestValidHit.Value.distance)
                    {
                        nearestValidHit = candidate;
                    }
                }

                if (nearestValidHit.HasValue)
                {
                    Vector3 hitDirection = nearestValidHit.Value.point - origin;
                    if (hitDirection.sqrMagnitude > 0.000001f)
                    {
                        return hitDirection.normalized;
                    }
                }

                return (ray.GetPoint(ManualAimDistance) - origin).normalized;
            }

            if (lockOn != null && lockOn.CurrentTarget != null)
            {
                return (lockOn.GetTargetAimPoint() - origin).normalized;
            }

            return transform.forward;
        }

        private bool IsOwnAimCollider(Collider candidate)
        {
            Transform candidateTransform = candidate != null ? candidate.transform : null;
            return candidateTransform != null
                   && (candidateTransform == transform || candidateTransform.IsChildOf(transform));
        }

        private void HandleDeath(HealthSnapshot _)
        {
            gameplayEnabled = false;
            lockOn?.ReleaseLock(false);
            animationDriver?.SetCombatEngaged(false);
            animationDriver?.SetAiming(false);
            if (defeatReturnRoutine == null && isActiveAndEnabled)
            {
                defeatReturnRoutine = StartCoroutine(ReturnToCampAfterDefeat());
            }
        }

        private IEnumerator ReturnToCampAfterDefeat()
        {
            if (defeatReturnDelay > 0f)
            {
                yield return new WaitForSecondsRealtime(defeatReturnDelay);
            }

            ExpeditionFlowController flow = ExpeditionFlowController.Instance;
            if (flow == null || !flow.ReturnToCampAfterDefeat())
            {
                Debug.LogWarning(
                    "[RuinCrawler Player] Defeat could not return to Camp because expedition flow is unavailable.",
                    this);
                defeatReturnRoutine = null;
            }
        }
    }
}
