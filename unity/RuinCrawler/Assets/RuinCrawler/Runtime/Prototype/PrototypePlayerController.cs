using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class PrototypePlayerController : MonoBehaviour
    {
        [SerializeField] private Transform muzzle;
        [SerializeField] private Material projectileMaterial;
        [SerializeField] private PrototypePlayerAnimationDriver animationDriver;
        [SerializeField] private PrototypeBusterVisual busterVisual;
        [SerializeField] private float walkSpeed = SourceGameplayContract.PlayerWalkSpeed;
        [SerializeField] private float jogSpeed = SourceGameplayContract.PlayerJogSpeed;
        [SerializeField] private float sprintSpeed = SourceGameplayContract.PlayerSprintSpeed;
        [SerializeField] private float rotationResponse = 14f;
        [SerializeField] private float fireInterval = SourceGameplayContract.MegaBusterFireInterval;
        private CharacterController characterController;
        private float verticalVelocity;
        private float fireCooldown;
        private bool walkModeEnabled;

        public bool WalkModeEnabled => walkModeEnabled;
        public Transform Muzzle => muzzle;
        public PrototypeBusterVisual BusterVisual => busterVisual;

        public void Configure(
            Transform projectileMuzzle,
            Material busterProjectileMaterial,
            PrototypePlayerAnimationDriver playerAnimationDriver,
            PrototypeBusterVisual equippedBusterVisual = null)
        {
            muzzle = projectileMuzzle;
            projectileMaterial = busterProjectileMaterial;
            animationDriver = playerAnimationDriver;
            busterVisual = equippedBusterVisual;
        }

        public void SetMegaBusterEquipped(bool equipped)
        {
            busterVisual?.SetEquipped(equipped);
        }

        /// <summary>
        /// Fires from the authored left barrel. The prototype has no lock-on
        /// target yet, so the animation driver first solves the physical
        /// barrel to gameplay forward and the projectile uses that same axis.
        /// </summary>
        public GameObject FireBusterShot()
        {
            busterVisual?.SetEquipped(true);
            animationDriver?.NotifyShotFired();
            animationDriver?.AlignBusterWithGameplayForward();

            Transform source = muzzle != null ? muzzle : transform;
            Vector3 launchDirection = source.forward.sqrMagnitude > 0.0001f
                ? source.forward.normalized
                : Vector3.forward;
            GameObject projectile = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            projectile.name = "PrototypeBusterShot";
            projectile.transform.SetPositionAndRotation(
                source.position,
                Quaternion.LookRotation(launchDirection, transform.up));
            projectile.transform.localScale = Vector3.one * (SourceGameplayContract.MegaBusterRadius * 2f);

            Collider projectileCollider = projectile.GetComponent<Collider>();
            if (projectileCollider != null)
            {
                Destroy(projectileCollider);
            }

            Renderer projectileRenderer = projectile.GetComponent<Renderer>();
            if (projectileRenderer != null && projectileMaterial != null)
            {
                projectileRenderer.sharedMaterial = projectileMaterial;
            }

            PrototypeProjectile behavior = projectile.AddComponent<PrototypeProjectile>();
            behavior.Initialize(launchDirection, SourceGameplayContract.MegaBusterDamage);
            return projectile;
        }

        private void Awake()
        {
            characterController = GetComponent<CharacterController>();
        }

        private void Update()
        {
            UpdateMovement();
            UpdateBuster();
        }

        private void UpdateMovement()
        {
            if (Input.GetKeyDown(KeyCode.LeftControl) || Input.GetKeyDown(KeyCode.RightControl))
            {
                walkModeEnabled = !walkModeEnabled;
            }

            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");
            Vector3 movement = new Vector3(horizontal, 0f, vertical);
            movement = Vector3.ClampMagnitude(movement, 1f);

            Camera activeCamera = Camera.main;
            if (activeCamera != null)
            {
                Vector3 cameraForward = activeCamera.transform.forward;
                Vector3 cameraRight = activeCamera.transform.right;
                cameraForward.y = 0f;
                cameraRight.y = 0f;
                movement = cameraForward.normalized * movement.z + cameraRight.normalized * movement.x;
            }

            if (movement.sqrMagnitude > 0.0001f)
            {
                Quaternion targetRotation = Quaternion.LookRotation(movement.normalized, Vector3.up);
                transform.rotation = Quaternion.Slerp(
                    transform.rotation,
                    targetRotation,
                    1f - Mathf.Exp(-rotationResponse * Time.deltaTime));
            }

            bool groundedBeforeMove = characterController.isGrounded;
            if (groundedBeforeMove && verticalVelocity < 0f)
            {
                verticalVelocity = -2f;
            }

            if (groundedBeforeMove && Input.GetKeyDown(KeyCode.Space))
            {
                verticalVelocity = 2f * SourceGameplayContract.PlayerJumpHeight
                                   / SourceGameplayContract.PlayerJumpTimeToApex;
            }

            float jumpGravity = -2f * SourceGameplayContract.PlayerJumpHeight
                                / (SourceGameplayContract.PlayerJumpTimeToApex
                                   * SourceGameplayContract.PlayerJumpTimeToApex);
            float gravityMultiplier = verticalVelocity <= 0f
                ? SourceGameplayContract.PlayerFallGravityMultiplier
                : 1f;
            verticalVelocity += jumpGravity * gravityMultiplier * Time.deltaTime;

            bool sprinting = !walkModeEnabled
                             && vertical > 0.35f
                             && (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift));
            float movementSpeed = walkModeEnabled
                ? walkSpeed
                : sprinting ? sprintSpeed : jogSpeed;
            Vector3 velocity = movement * movementSpeed + Vector3.up * verticalVelocity;
            CollisionFlags collisionFlags = characterController.Move(velocity * Time.deltaTime);
            bool groundedAfterMove = characterController.isGrounded
                                     || (collisionFlags & CollisionFlags.Below) != 0;
            if (groundedAfterMove && verticalVelocity < 0f)
            {
                verticalVelocity = -2f;
            }

            animationDriver?.ApplyMotion(
                characterController.velocity,
                groundedAfterMove,
                verticalVelocity,
                Time.deltaTime);
        }

        private void UpdateBuster()
        {
            fireCooldown = Mathf.Max(0f, fireCooldown - Time.deltaTime);
            if (fireCooldown > 0f || !Input.GetMouseButton(0))
            {
                return;
            }

            fireCooldown = fireInterval;
            FireBusterShot();
        }
    }
}
