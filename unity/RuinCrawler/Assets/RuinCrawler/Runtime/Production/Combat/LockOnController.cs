using System;
using System.Collections.Generic;
using RuinCrawler.Core.Foundation;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.Runtime.Combat
{
    /// <summary>
    /// Sticky source-parity lock owner. Acquisition is range constrained, but
    /// a completed player lock is retained until the target becomes invalid,
    /// explicitly releases, dies, or resolves to an authored fallback.
    /// </summary>
    public sealed class LockOnController : MonoBehaviour
    {
        private const float ReticleRadiusPixels = 17f;
        private const float SkipDuration = 0.42f;

        [SerializeField] private InputActionAsset inputActions;
        [SerializeField] private Camera gameplayCamera;
        [SerializeField, Min(0.1f)] private float acquisitionRange = 12f;
        [SerializeField, Min(0.12f)] private float lockTime = 0.44f;

        private CombatWorld world;
        private InputAction toggleLockAction;
        private InputAction manualAimAction;
        private InputAction cycleTargetAction;
        private CombatTargetId? currentTargetId;
        private CombatTargetId? skippedTargetId;
        private float skippedTargetRemaining;
        private float lockProgress;
        private bool movementLocked;
        private bool manualAimHeld;

        public event Action<CombatTargetComponent> TargetChanged;
        public event Action<float, bool> LockProgressChanged;

        public CombatTargetComponent CurrentTarget
        {
            get
            {
                return currentTargetId.HasValue
                       && world != null
                       && world.TryGetComponent(currentTargetId.Value, out CombatTargetComponent component)
                    ? component
                    : null;
            }
        }

        public bool MovementLocked => movementLocked && CurrentTarget != null;
        public bool ManualAimHeld => manualAimHeld;
        public float LockProgress => lockProgress;
        public bool IsLocked => CurrentTarget != null && lockProgress >= 1f;
        public InputActionAsset InputActions => inputActions;

        public void Configure(InputActionAsset actions, Camera targetCamera, float range = 12f)
        {
            UnbindInput();
            inputActions = actions;
            gameplayCamera = targetCamera;
            acquisitionRange = Mathf.Max(0.1f, range);
            BindInput();
        }

        public Vector3 GetTargetAimPoint()
        {
            CombatTargetComponent target = CurrentTarget;
            return target != null ? target.AimTransform.position : transform.position + transform.forward * acquisitionRange;
        }

        public bool TryAcquireNearest(bool completeImmediately = false)
        {
            CombatTargetComponent best = FindNearestCandidate();
            if (best == null)
            {
                return false;
            }

            SetTarget(best, completeImmediately ? 1f : 0f, true);
            return true;
        }

        public void ReleaseLock(bool rememberSkippedTarget = true)
        {
            if (rememberSkippedTarget && currentTargetId.HasValue)
            {
                skippedTargetId = currentTargetId;
                skippedTargetRemaining = SkipDuration;
            }

            currentTargetId = null;
            lockProgress = 0f;
            movementLocked = false;
            TargetChanged?.Invoke(null);
            LockProgressChanged?.Invoke(0f, false);
        }

        private void Awake()
        {
            world = CombatWorld.GetOrCreate();
            if (gameplayCamera == null)
            {
                gameplayCamera = Camera.main;
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

        private void Update()
        {
            skippedTargetRemaining = Mathf.Max(0f, skippedTargetRemaining - Time.deltaTime);
            if (skippedTargetRemaining <= 0f)
            {
                skippedTargetId = null;
            }

            ResolveCurrentTarget();
            if (CurrentTarget != null && lockProgress < 1f)
            {
                lockProgress = Mathf.Min(1f, lockProgress + Time.deltaTime / Mathf.Max(0.12f, lockTime));
                LockProgressChanged?.Invoke(lockProgress, lockProgress >= 1f);
            }
        }

        private void BindInput()
        {
            if (!isActiveAndEnabled || inputActions == null || toggleLockAction != null)
            {
                return;
            }

            toggleLockAction = inputActions.FindAction("Gameplay/ToggleLock", false);
            manualAimAction = inputActions.FindAction("Gameplay/ManualAim", false);
            cycleTargetAction = inputActions.FindAction("Gameplay/CycleTarget", false);
            if (toggleLockAction != null)
            {
                toggleLockAction.performed += HandleToggleLock;
            }

            if (manualAimAction != null)
            {
                manualAimAction.performed += HandleManualAimStarted;
                manualAimAction.canceled += HandleManualAimEnded;
            }

            if (cycleTargetAction != null)
            {
                cycleTargetAction.performed += HandleCycleTarget;
            }

            inputActions.FindActionMap("Gameplay", false)?.Enable();
        }

        private void UnbindInput()
        {
            if (toggleLockAction != null)
            {
                toggleLockAction.performed -= HandleToggleLock;
            }

            if (manualAimAction != null)
            {
                manualAimAction.performed -= HandleManualAimStarted;
                manualAimAction.canceled -= HandleManualAimEnded;
            }

            if (cycleTargetAction != null)
            {
                cycleTargetAction.performed -= HandleCycleTarget;
            }

            toggleLockAction = null;
            manualAimAction = null;
            cycleTargetAction = null;
        }

        private void HandleToggleLock(InputAction.CallbackContext _)
        {
            if (movementLocked)
            {
                ReleaseLock();
                return;
            }

            TryAcquireNearest();
        }

        private void HandleManualAimStarted(InputAction.CallbackContext _)
        {
            manualAimHeld = true;
            CombatTargetComponent reticleTarget = FindReticleCandidate();
            if (reticleTarget != null)
            {
                SetTarget(reticleTarget, 1f, true);
            }
        }

        private void HandleManualAimEnded(InputAction.CallbackContext _)
        {
            manualAimHeld = false;
        }

        private void HandleCycleTarget(InputAction.CallbackContext context)
        {
            float direction = context.ReadValue<float>();
            if (Mathf.Abs(direction) < 0.1f)
            {
                return;
            }

            Cycle(direction > 0f ? 1 : -1);
        }

        private void ResolveCurrentTarget()
        {
            if (!currentTargetId.HasValue || world == null)
            {
                return;
            }

            CombatTargetId requested = currentTargetId.Value;
            if (!world.Registry.TryResolveRetainable(requested, out CombatTargetDescriptor resolved))
            {
                ReleaseLock(false);
                return;
            }

            if (resolved.TargetId != requested)
            {
                currentTargetId = resolved.TargetId;
                TargetChanged?.Invoke(CurrentTarget);
            }
        }

        private CombatTargetComponent FindNearestCandidate()
        {
            CombatTargetComponent best = null;
            float bestScore = float.PositiveInfinity;
            foreach (CombatTargetComponent candidate in GetValidCandidates())
            {
                float distance = Vector3.Distance(transform.position, candidate.AimTransform.position);
                float score = distance * (candidate.Kind == CombatTargetKind.WeakPoint ? 0.94f : 1f);
                if (score < bestScore)
                {
                    bestScore = score;
                    best = candidate;
                }
            }

            return best;
        }

        private CombatTargetComponent FindReticleCandidate()
        {
            if (gameplayCamera == null)
            {
                return null;
            }

            Vector2 center = new Vector2(Screen.width * 0.5f, Screen.height * 0.5f);
            CombatTargetComponent best = null;
            float bestScore = float.PositiveInfinity;
            foreach (CombatTargetComponent candidate in GetValidCandidates())
            {
                Vector3 screen = gameplayCamera.WorldToScreenPoint(candidate.AimTransform.position);
                if (screen.z <= 0f)
                {
                    continue;
                }

                float projectedRadius = candidate.CreateDescriptor().LockRadius <= 0d
                    ? 0f
                    : (float)candidate.CreateDescriptor().LockRadius * Screen.height
                      / (2f * screen.z * Mathf.Tan(gameplayCamera.fieldOfView * Mathf.Deg2Rad * 0.5f));
                float pixelDistance = Vector2.Distance(center, new Vector2(screen.x, screen.y));
                float allowed = ReticleRadiusPixels + Mathf.Max(2f, projectedRadius);
                if (pixelDistance > allowed)
                {
                    continue;
                }

                float score = pixelDistance * (candidate.Kind == CombatTargetKind.WeakPoint ? 0.94f : 1f);
                if (score < bestScore)
                {
                    bestScore = score;
                    best = candidate;
                }
            }

            return best;
        }

        private List<CombatTargetComponent> GetValidCandidates()
        {
            var result = new List<CombatTargetComponent>();
            if (world == null)
            {
                return result;
            }

            foreach (CombatTargetComponent candidate in world.GetComponentsSnapshot())
            {
                if (candidate == null || !candidate.IsTargetActive || candidate.OwnerHealth == null || candidate.OwnerHealth.IsDead)
                {
                    continue;
                }

                if (skippedTargetRemaining > 0f && skippedTargetId.HasValue && skippedTargetId.Value == candidate.TargetId)
                {
                    continue;
                }

                if (Vector3.Distance(transform.position, candidate.AimTransform.position) <= acquisitionRange)
                {
                    result.Add(candidate);
                }
            }

            return result;
        }

        private void Cycle(int direction)
        {
            List<CombatTargetComponent> candidates = GetValidCandidates();
            if (candidates.Count == 0)
            {
                return;
            }

            candidates.Sort((left, right) => string.CompareOrdinal(left.TargetId.Value, right.TargetId.Value));
            int currentIndex = currentTargetId.HasValue
                ? candidates.FindIndex(candidate => candidate.TargetId == currentTargetId.Value)
                : -1;
            int nextIndex = currentIndex < 0
                ? 0
                : (currentIndex + direction + candidates.Count) % candidates.Count;
            SetTarget(candidates[nextIndex], 0f, true);
        }

        private void SetTarget(CombatTargetComponent target, float progress, bool lockMovement)
        {
            if (target == null)
            {
                ReleaseLock(false);
                return;
            }

            currentTargetId = target.TargetId;
            lockProgress = Mathf.Clamp01(progress);
            movementLocked = lockMovement;
            skippedTargetId = null;
            skippedTargetRemaining = 0f;
            TargetChanged?.Invoke(target);
            LockProgressChanged?.Invoke(lockProgress, lockProgress >= 1f);
        }
    }
}
