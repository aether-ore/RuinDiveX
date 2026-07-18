using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    /// <summary>
    /// Presentation-only bridge between gameplay movement and the Volnutt
    /// Animator. Gameplay remains authoritative for movement, firing, and
    /// timing; this component only publishes state to the animation graph and
    /// removes authored root translation after the graph has evaluated.
    /// </summary>
    [RequireComponent(typeof(Animator))]
    public sealed class PrototypePlayerAnimationDriver : MonoBehaviour
    {
        public const string SpeedParameter = "Speed";
        public const string GroundedParameter = "Grounded";
        public const string VerticalSpeedParameter = "VerticalSpeed";
        public const string AimingParameter = "Aiming";
        public const string CombatReadinessParameter = "CombatReadiness";
        public const string BusterLayer = "UpperBodyBuster";

        public static readonly int SpeedHash = Animator.StringToHash(SpeedParameter);
        public static readonly int GroundedHash = Animator.StringToHash(GroundedParameter);
        public static readonly int VerticalSpeedHash = Animator.StringToHash(VerticalSpeedParameter);
        public static readonly int AimingHash = Animator.StringToHash(AimingParameter);
        public static readonly int CombatReadinessHash = Animator.StringToHash(CombatReadinessParameter);

        [SerializeField] private Animator animator;
        [SerializeField] private Transform hips;
        [SerializeField] private Transform busterShoulder;
        [SerializeField] private Transform busterForearm;
        [SerializeField] private Transform busterMuzzle;
        [SerializeField] private float speedDampTime = 0.08f;
        [SerializeField] private float aimLockDuration = Porting.SourceGameplayContract.MegaBusterAimLockDuration;
        [SerializeField] private float aimLayerBlendSpeed = 14f;
        [SerializeField] private float combatIdleBlendSpeed = 6f;
        [SerializeField] private float idleRootBlendSpeed = 8f;

        private Vector3 hipsBindLocalPosition;
        private float aimLockRemaining;
        private float aimLayerWeight;
        private float combatIdleRemaining = Porting.SourceGameplayContract.PlayerCombatIdleHoldSeconds;
        private float combatReadiness = 1f;
        private float idleRootPreserveWeight = 1f;
        private int busterLayerIndex = -1;
        private bool grounded = true;
        private bool combatEngaged;
        private Vector3 aimWorldDirection;

        public Animator Animator => animator;
        public Transform Hips => hips;
        public Transform BusterShoulder => busterShoulder;
        public Transform BusterForearm => busterForearm;
        public Transform BusterMuzzle => busterMuzzle;
        public bool IsAiming => animator != null && animator.GetBool(AimingHash);
        public bool IsCombatReady => combatEngaged || combatIdleRemaining > 0f;
        public float CombatIdleRemaining => combatIdleRemaining;
        public float IdleRootPreserveWeight => idleRootPreserveWeight;

        public void Configure(
            Animator targetAnimator,
            Transform hipsTransform,
            Transform busterShoulderTransform,
            Transform busterMuzzleTransform)
        {
            animator = targetAnimator;
            hips = hipsTransform;
            busterShoulder = busterShoulderTransform;
            if (busterForearm == null)
            {
                busterForearm = FindDescendant(transform, "mixamorig:LeftForeArm");
            }
            busterMuzzle = busterMuzzleTransform;
            CaptureBindPose();
            ApplyAnimatorContract();
        }

        public void ApplyMotion(Vector3 actualWorldVelocity, bool isGrounded, float verticalVelocity, float deltaTime)
        {
            if (animator == null)
            {
                return;
            }

            grounded = isGrounded;
            float horizontalSpeed = new Vector2(actualWorldVelocity.x, actualWorldVelocity.z).magnitude;
            animator.SetFloat(SpeedHash, horizontalSpeed, speedDampTime, Mathf.Max(0f, deltaTime));
            animator.SetBool(GroundedHash, isGrounded);
            animator.SetFloat(VerticalSpeedHash, isGrounded ? 0f : verticalVelocity);
        }

        public void NotifyShotFired()
        {
            NotifyCombatActivity();
            aimLockRemaining = Mathf.Max(aimLockRemaining, aimLockDuration);
            SetAiming(true);
        }

        /// <summary>
        /// Restarts the combat-ready Action Idle window. Future lock-on,
        /// damage, and enemy-awareness systems can use the same presentation
        /// contract without teaching the animation driver combat rules.
        /// </summary>
        public void NotifyCombatActivity()
        {
            combatIdleRemaining = Porting.SourceGameplayContract.PlayerCombatIdleHoldSeconds;
        }

        /// <summary>
        /// Holds Action Idle while a gameplay combat context is explicitly
        /// active. Releasing the context begins the normal 20-second cooldown.
        /// </summary>
        public void SetCombatEngaged(bool value)
        {
            combatEngaged = value;
            if (value)
            {
                NotifyCombatActivity();
            }
        }

        public void SetAiming(bool value)
        {
            if (animator == null)
            {
                return;
            }

            if (!value)
            {
                aimLockRemaining = 0f;
            }
            else
            {
                NotifyCombatActivity();
            }
            animator.SetBool(AimingHash, value);
        }

        /// <summary>
        /// Solves the animated left shoulder in world space so the physical
        /// Buster barrel agrees with gameplay forward. The base clips animate
        /// the spine and clavicle, so a single baked local arm rotation cannot
        /// remain on target across idle, locomotion, and jump poses.
        /// </summary>
        public void AlignBusterWithGameplayForward()
        {
            AlignBusterWithWorldDirection(transform.forward);
        }

        /// <summary>
        /// Queues the authoritative gameplay direction for the post-Animator
        /// pose pass. Updating bones from a gameplay Update and again from
        /// LateUpdate allows a rendered frame to catch a half-solved arm when
        /// the Animator evaluates between those passes.
        /// </summary>
        public void SetBusterAimDirection(Vector3 gameplayDirection)
        {
            if (gameplayDirection.sqrMagnitude > 0.000001f)
            {
                aimWorldDirection = gameplayDirection.normalized;
            }
        }

        /// <summary>
        /// Solves the visible barrel to the exact gameplay aim vector. Lock-on
        /// targets can therefore be above or below Volnutt without allowing
        /// the left arm to fall back toward the ground.
        /// </summary>
        public void AlignBusterWithWorldDirection(Vector3 gameplayDirection)
        {
            SetBusterAimDirection(gameplayDirection);

            if (busterShoulder == null || busterMuzzle == null
                || aimWorldDirection.sqrMagnitude <= 0.000001f)
            {
                return;
            }

            Vector3 gameplayForward = aimWorldDirection;
            if (busterForearm == null)
            {
                // Compatibility fallback for an older prefab: it still aims
                // accurately, but cannot independently guarantee both the
                // straight upper-arm line and imported barrel orientation.
                RotateBoneToAim(busterShoulder, busterMuzzle.forward, gameplayForward);
                return;
            }

            Vector3 upperArmDirection = busterForearm.position - busterShoulder.position;
            if (upperArmDirection.sqrMagnitude > 0.000001f)
            {
                // The Mega Buster replaces the forearm, so putting the elbow
                // directly on the shot vector produces one continuous,
                // straight shoulder-to-barrel silhouette. Preserve the
                // Animator-authored roll and only swing the upper arm toward
                // the authoritative gameplay direction.
                RotateBoneToAim(busterShoulder, upperArmDirection, gameplayForward);
            }

            // The Buster's imported barrel axis is independent of the upper
            // arm bone axis. Correct it after the shoulder so the visible
            // muzzle and spawned projectile remain exactly collinear.
            RotateBoneToAim(busterForearm, busterMuzzle.forward, gameplayForward);
        }

        private void Awake()
        {
            if (animator == null)
            {
                animator = GetComponent<Animator>();
            }
            if (hips == null)
            {
                hips = FindDescendant(transform, "mixamorig:Hips");
            }
            if (busterShoulder == null)
            {
                busterShoulder = FindDescendant(transform, "mixamorig:LeftArm");
            }
            if (busterForearm == null)
            {
                busterForearm = FindDescendant(transform, "mixamorig:LeftForeArm");
            }
            if (busterMuzzle == null)
            {
                busterMuzzle = FindDescendant(transform, "BusterMuzzle");
            }

            CaptureBindPose();
            ApplyAnimatorContract();
        }

        private void Update()
        {
            if (combatEngaged)
            {
                combatIdleRemaining = Porting.SourceGameplayContract.PlayerCombatIdleHoldSeconds;
            }
            else
            {
                combatIdleRemaining = Mathf.Max(0f, combatIdleRemaining - Time.deltaTime);
            }

            float combatTarget = IsCombatReady ? 1f : 0f;
            combatReadiness = Mathf.MoveTowards(
                combatReadiness,
                combatTarget,
                combatIdleBlendSpeed * Time.deltaTime);
            if (animator != null)
            {
                animator.SetFloat(CombatReadinessHash, combatReadiness);
            }

            if (aimLockRemaining > 0f)
            {
                aimLockRemaining = Mathf.Max(0f, aimLockRemaining - Time.deltaTime);
                if (aimLockRemaining <= 0f)
                {
                    SetAiming(false);
                }
            }

            if (animator != null && busterLayerIndex >= 0)
            {
                float targetWeight = animator.GetBool(AimingHash) ? 1f : 0f;
                aimLayerWeight = Mathf.MoveTowards(
                    aimLayerWeight,
                    targetWeight,
                    aimLayerBlendSpeed * Time.deltaTime);
                animator.SetLayerWeight(busterLayerIndex, aimLayerWeight);
            }

            if (animator != null)
            {
                AnimatorStateInfo baseState = animator.GetCurrentAnimatorStateInfo(0);
                bool locomotionState = baseState.IsName("Locomotion")
                                       || (animator.IsInTransition(0)
                                           && animator.GetNextAnimatorStateInfo(0).IsName("Locomotion"));
                float smoothedSpeed = animator.GetFloat(SpeedHash);
                float rootTarget = grounded
                                   && locomotionState
                                   && smoothedSpeed <= 0.05f
                    ? 1f
                    : 0f;
                idleRootPreserveWeight = Mathf.MoveTowards(
                    idleRootPreserveWeight,
                    rootTarget,
                    idleRootBlendSpeed * Time.deltaTime);
            }
        }

        private void LateUpdate()
        {
            if (hips != null)
            {
                // Breathing Idle's small authored pelvis sway is paired with its
                // leg curves and is required to keep the feet planted. Preserve it
                // at rest, then fade back to gameplay-owned X/Z before locomotion
                // clips take over. Jump clips still lock Y so authored lift cannot
                // double the physics-owned jump arc.
                Vector3 animatedPosition = hips.localPosition;
                hips.localPosition = new Vector3(
                    Mathf.Lerp(hipsBindLocalPosition.x, animatedPosition.x, idleRootPreserveWeight),
                    grounded ? animatedPosition.y : hipsBindLocalPosition.y,
                    Mathf.Lerp(hipsBindLocalPosition.z, animatedPosition.z, idleRootPreserveWeight));
            }

            if (IsAiming)
            {
                AlignBusterWithWorldDirection(
                    aimWorldDirection.sqrMagnitude > 0.000001f
                        ? aimWorldDirection
                        : transform.forward);
            }
        }

        private void CaptureBindPose()
        {
            if (hips != null)
            {
                hipsBindLocalPosition = hips.localPosition;
            }
        }

        private void ApplyAnimatorContract()
        {
            if (animator == null)
            {
                return;
            }

            animator.applyRootMotion = false;
            animator.keepAnimatorStateOnDisable = true;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            animator.SetBool(GroundedHash, true);
            animator.SetFloat(CombatReadinessHash, combatReadiness);
            busterLayerIndex = animator.GetLayerIndex(BusterLayer);
            if (busterLayerIndex >= 0)
            {
                aimLayerWeight = animator.GetBool(AimingHash) ? 1f : 0f;
                animator.SetLayerWeight(busterLayerIndex, aimLayerWeight);
            }
        }

        private static Transform FindDescendant(Transform root, string targetName)
        {
            foreach (Transform candidate in root.GetComponentsInChildren<Transform>(true))
            {
                if (candidate.name == targetName)
                {
                    return candidate;
                }
            }
            return null;
        }

        private static void RotateBoneToAim(
            Transform bone,
            Vector3 currentWorldDirection,
            Vector3 desiredWorldDirection)
        {
            if (bone == null
                || currentWorldDirection.sqrMagnitude <= 0.000001f
                || desiredWorldDirection.sqrMagnitude <= 0.000001f)
            {
                return;
            }

            Quaternion correction = Quaternion.FromToRotation(
                currentWorldDirection.normalized,
                desiredWorldDirection.normalized);
            bone.rotation = (correction * bone.rotation).normalized;
        }
    }
}
