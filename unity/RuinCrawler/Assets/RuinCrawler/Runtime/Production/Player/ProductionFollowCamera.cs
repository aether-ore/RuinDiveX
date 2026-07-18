using RuinCrawler.Port.Porting;
using RuinCrawler.Runtime.Combat;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.Runtime.Player
{
    public sealed class ProductionFollowCamera : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private LockOnController lockOn;
        [SerializeField] private InputActionAsset inputActions;
        [SerializeField] private float distance = SourceGameplayContract.CameraDistance;
        [SerializeField] private float height = SourceGameplayContract.CameraHeight;
        [SerializeField] private float response = SourceGameplayContract.CameraFollowResponsiveness;
        [SerializeField] private float lookSensitivity = 0.16f;
        [SerializeField] private float yawResponse = SourceGameplayContract.CameraYawResponsiveness;
        [SerializeField] private float tankTurnYawResponse = SourceGameplayContract.CameraTankTurnYawResponsiveness;
        [SerializeField] private float minimumPitch = -18f;
        [SerializeField] private float maximumPitch = 48f;
        [SerializeField] private float aimRecenterDuration = 0.42f;
        [SerializeField] private float aimRecenterResponse = 18f;
        [Header("Interior shell collision")]
        [SerializeField] private LayerMask collisionMask = ~0;
        [SerializeField, Min(0.05f)] private float collisionProbeRadius = 0.28f;
        [SerializeField, Min(0f)] private float collisionPadding = 0.08f;

        private InputAction lookAction;
        private float yaw;
        private float pitch = 12f;
        private float aimRecenterRemaining;
        private bool manualAimWasHeld;
        private ProductionPlayerController playerController;
        private readonly RaycastHit[] collisionHits = new RaycastHit[24];

        public float OrbitYaw => yaw;
        public bool IsAimModeActive => lockOn != null
                                         && (lockOn.ManualAimHeld || lockOn.CurrentTarget != null);
        public bool IsAimRecentering => aimRecenterRemaining > 0f;

        public void Configure(Transform followTarget, LockOnController targetLock, InputActionAsset actions)
        {
            target = followTarget;
            lockOn = targetLock;
            inputActions = actions;
            playerController = followTarget != null
                ? followTarget.GetComponent<ProductionPlayerController>()
                : null;
            yaw = followTarget != null ? followTarget.eulerAngles.y : transform.eulerAngles.y;
            BindInput();
        }

        public void ConfigureInteriorCollision(
            LayerMask mask,
            float probeRadius = 0.28f,
            float padding = 0.08f)
        {
            collisionMask = mask;
            collisionProbeRadius = Mathf.Max(0.05f, probeRadius);
            collisionPadding = Mathf.Max(0f, padding);
        }

        private void OnEnable()
        {
            BindInput();
        }

        private void OnDisable()
        {
            lookAction = null;
            aimRecenterRemaining = 0f;
            manualAimWasHeld = false;
        }

        private void BindInput()
        {
            if (inputActions != null && lookAction == null)
            {
                lookAction = inputActions.FindAction("Gameplay/Look", false);
                inputActions.FindActionMap("Gameplay", false)?.Enable();
            }
        }

        private void LateUpdate()
        {
            if (target == null)
            {
                return;
            }

            if (playerController == null)
            {
                // Production composition configures the camera before adding
                // the player controller to the imported prefab.
                playerController = target.GetComponent<ProductionPlayerController>();
            }

            Vector2 look = lookAction?.ReadValue<Vector2>() ?? Vector2.zero;
            // Horizontal camera orbit fights the tank-control contract and can
            // leave the reticle looking across Mega Man's shoulder. A/D (or
            // the left stick) owns body yaw; the camera continuously follows
            // that yaw. Vertical look remains available for elevation aiming.
            pitch = Mathf.Clamp(pitch - look.y * lookSensitivity, minimumPitch, maximumPitch);

            bool manualAim = lockOn != null && lockOn.ManualAimHeld;
            if (manualAim && !manualAimWasHeld)
            {
                aimRecenterRemaining = aimRecenterDuration;
            }
            manualAimWasHeld = manualAim;

            float bodyYaw = target.eulerAngles.y;
            float activeYawResponse = aimRecenterRemaining > 0f
                ? aimRecenterResponse
                : playerController != null && playerController.IsTankTurning
                    ? tankTurnYawResponse
                    : yawResponse;
            yaw = Mathf.LerpAngle(
                yaw,
                bodyYaw,
                1f - Mathf.Exp(-activeYawResponse * Time.deltaTime));

            if (aimRecenterRemaining > 0f)
            {
                aimRecenterRemaining = Mathf.Max(0f, aimRecenterRemaining - Time.deltaTime);
            }

            Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
            Vector3 lookTarget = target.position
                                 + Vector3.up * SourceGameplayContract.CameraLookHeight
                                 + target.forward * SourceGameplayContract.CameraLookAhead;
            Vector3 desiredPosition = lookTarget + orbit * new Vector3(0f, height * 0.18f, -distance);
            desiredPosition = ClampInsideShell(lookTarget, desiredPosition);
            Vector3 smoothedPosition = Vector3.Lerp(
                transform.position,
                desiredPosition,
                1f - Mathf.Exp(-response * Time.deltaTime));
            transform.position = ClampInsideShell(lookTarget, smoothedPosition);
            transform.rotation = Quaternion.LookRotation(lookTarget - transform.position, Vector3.up);
        }

        private Vector3 ClampInsideShell(Vector3 lookTarget, Vector3 candidate)
        {
            Vector3 displacement = candidate - lookTarget;
            float requestedDistance = displacement.magnitude;
            if (requestedDistance <= 0.0001f) return candidate;

            Vector3 direction = displacement / requestedDistance;
            int hitCount = Physics.SphereCastNonAlloc(
                lookTarget,
                collisionProbeRadius,
                direction,
                collisionHits,
                requestedDistance,
                collisionMask,
                QueryTriggerInteraction.Ignore);
            float nearest = requestedDistance;
            for (int index = 0; index < hitCount; index += 1)
            {
                Collider collider = collisionHits[index].collider;
                if (collider == null || collider.isTrigger || IsPlayerCollider(collider.transform)) continue;
                nearest = Mathf.Min(nearest, collisionHits[index].distance);
            }
            if (nearest >= requestedDistance) return candidate;

            // Exterior containment wins over the preferred camera distance in
            // a narrow doorway or low ceiling. Enforcing the preference past
            // the hit plane would put the camera outside the certified shell.
            float resolvedDistance = Mathf.Clamp(
                nearest - collisionPadding,
                0.05f,
                requestedDistance);
            return lookTarget + direction * resolvedDistance;
        }

        private bool IsPlayerCollider(Transform candidate)
        {
            if (candidate == null || target == null) return false;
            return candidate == target
                   || candidate.IsChildOf(target)
                   || target.IsChildOf(candidate);
        }
    }
}
