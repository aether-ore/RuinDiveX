using System;
using System.Collections.Generic;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Combat;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots
{
    public enum ReaverbotRuntimeState
    {
        Dormant,
        Pursuing,
        Telegraphing,
        Committing,
        Recovering,
        Dead,
    }

    /// <summary>
    /// Scene adapter for one immutable genome. Combat numbers come from the
    /// genome plus explicit encounter-level scales (for example Boss Hunts),
    /// then flow through DamagePacket/HealthState. This component decides when
    /// movement and authored attack phases occur.
    /// </summary>
    public sealed class ReaverbotRuntimeController : MonoBehaviour
    {
        private ReaverbotGenome genome;
        private ReaverbotVisualRig rig;
        private CharacterController characterController;
        private HealthComponent health;
        private CombatTargetComponent bodyTarget;
        private CombatTargetComponent weakPointTarget;
        private Collider weakPointCollider;
        private ProductionProjectilePool projectilePool;
        private ReaverbotSalvageCatalog salvageCatalog;
        private Transform combatTarget;
        private HealthComponent targetHealth;
        private bool aerial;
        private bool initialized;
        private bool deathHandled;
        private bool encounterRecoverySuppressed;
        private bool lethalPacketRecoverySuppressed;
        private float stateTimer;
        private float stateDuration;
        private float attackCooldown;
        private float targetSearchTimer;
        private float deadTimer;
        private long attackSequence;
        private ReaverbotRuntimeState state;
        private double runtimeDamageScale = 1d;
        private double runtimeCooldownScale = 1d;
        private bool automaticDespawn = true;

        public event Action<ReaverbotRuntimeController, UnidentifiedReaverbotRecovery> Died;
        public event Action<ReaverbotRuntimeController> DespawnRequested;
        public event Action<ReaverbotRuntimeController> BecameAware;

        public ReaverbotGenome Genome => genome;
        public string StableSpawnId { get; private set; }
        public string DisplayName { get; private set; }
        public string VisualKey => rig?.VisualKey;
        public ReaverbotRuntimeState State => state;
        public HealthComponent Health => health;
        public CombatTargetComponent BodyTarget => bodyTarget;
        public CombatTargetComponent WeakPointTarget => weakPointTarget;
        public Transform Muzzle => rig?.Muzzle;
        public Transform BodyAim => rig?.BodyAim;
        public Transform WeakPointAnchor => rig?.WeakPoint;
        public bool IsDead => state == ReaverbotRuntimeState.Dead;
        public double RuntimeDamageScale => runtimeDamageScale;
        public double RuntimeCooldownScale => runtimeCooldownScale;
        public bool AutomaticDespawn => automaticDespawn;

        public void Initialize(
            ReaverbotGenome sourceGenome,
            string stableSpawnId,
            string displayName,
            ReaverbotVisualRig visualRig,
            CharacterController movementController,
            HealthComponent healthComponent,
            CombatTargetComponent bodyTargetComponent,
            CombatTargetComponent weakTargetComponent,
            Collider weakCollider,
            ProductionProjectilePool enemyProjectilePool,
            ReaverbotSalvageCatalog sourceSalvageCatalog,
            Transform initialCombatTarget)
        {
            if (sourceGenome == null) throw new ArgumentNullException(nameof(sourceGenome));
            if (string.IsNullOrWhiteSpace(stableSpawnId)) throw new ArgumentException("A stable spawn id is required.", nameof(stableSpawnId));
            genome = sourceGenome;
            rig = visualRig ?? throw new ArgumentNullException(nameof(visualRig));
            characterController = movementController ?? throw new ArgumentNullException(nameof(movementController));
            health = healthComponent ?? throw new ArgumentNullException(nameof(healthComponent));
            bodyTarget = bodyTargetComponent ?? throw new ArgumentNullException(nameof(bodyTargetComponent));
            weakPointTarget = weakTargetComponent ?? throw new ArgumentNullException(nameof(weakTargetComponent));
            weakPointCollider = weakCollider ?? throw new ArgumentNullException(nameof(weakCollider));
            projectilePool = enemyProjectilePool;
            salvageCatalog = sourceSalvageCatalog ?? throw new ArgumentNullException(nameof(sourceSalvageCatalog));
            StableSpawnId = stableSpawnId.Trim();
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? genome.Name : displayName.Trim();
            aerial = genome.Body.Definition.HasTag("aerial") || genome.Body.Definition.HasTag("hovering");
            runtimeDamageScale = 1d;
            runtimeCooldownScale = 1d;
            automaticDespawn = true;
            transform.localScale = Vector3.one;

            UnbindHealth();
            health.Configure((float)genome.Stats.MaxHealth, (float)genome.Stats.Armor, false);
            health.Damaged += HandleDamaged;
            health.Died += HandleDied;

            characterController.enabled = true;
            characterController.radius = Mathf.Max(0.12f, (float)genome.Stats.Radius);
            characterController.height = Mathf.Max(characterController.radius * 2f, (float)genome.Stats.CollisionHeight);
            characterController.center = new Vector3(0f, characterController.height * 0.5f, 0f);
            characterController.stepOffset = Mathf.Min(0.45f, characterController.height * 0.2f);
            characterController.slopeLimit = 48f;

            string ownerId = StableSpawnId + ".body";
            bodyTarget.Configure(
                ownerId,
                ownerId,
                DisplayName,
                health,
                rig.BodyAim,
                CombatTargetKind.Body,
                null,
                (float)genome.Stats.Radius,
                false,
                null);
            bodyTarget.SetTargetActive(true);
            weakPointTarget.Configure(
                StableSpawnId + ".weak." + genome.Modules.WeakPoint.Id,
                ownerId,
                DisplayName,
                health,
                rig.WeakPoint,
                CombatTargetKind.WeakPoint,
                genome.Modules.WeakPoint.Label,
                Mathf.Max(0.08f, (float)genome.Modules.WeakPoint.Radius),
                true,
                ownerId);

            deathHandled = false;
            encounterRecoverySuppressed = false;
            lethalPacketRecoverySuppressed = false;
            state = ReaverbotRuntimeState.Dormant;
            stateTimer = 0f;
            stateDuration = 0f;
            attackCooldown = Mathf.Min(0.35f, (float)genome.Stats.AttackCooldown);
            targetSearchTimer = 0f;
            deadTimer = 0f;
            attackSequence = 0;
            initialized = true;
            rig.ResetPose();
            SetTarget(initialCombatTarget);
            UpdateWeakPointExposure();
        }

        /// <summary>
        /// Applies an authored encounter's immutable stat scales without
        /// mutating the generated genome. Initialize resets these values so a
        /// pooled boss can safely return to ordinary encounter duty.
        /// </summary>
        public void ConfigureCombatScales(double damageScale, double cooldownScale)
        {
            if (double.IsNaN(damageScale) || double.IsInfinity(damageScale) || damageScale <= 0d)
                throw new ArgumentOutOfRangeException(nameof(damageScale));
            if (double.IsNaN(cooldownScale) || double.IsInfinity(cooldownScale) || cooldownScale <= 0d)
                throw new ArgumentOutOfRangeException(nameof(cooldownScale));
            runtimeDamageScale = damageScale;
            runtimeCooldownScale = cooldownScale;
            if (genome != null)
            {
                attackCooldown = Mathf.Min(
                    attackCooldown,
                    Mathf.Max(0.05f, (float)(genome.Stats.AttackCooldown * runtimeCooldownScale)));
            }
        }

        public void SetRecoverySuppressed(bool suppressed)
        {
            encounterRecoverySuppressed = suppressed;
        }

        public void ConfigureAutomaticDespawn(bool enabled)
        {
            automaticDespawn = enabled;
        }

        public void SetTarget(Transform target)
        {
            combatTarget = target;
            targetHealth = target != null ? target.GetComponentInParent<HealthComponent>() : null;
            if (targetHealth == null && target != null)
            {
                targetHealth = target.GetComponentInChildren<HealthComponent>();
            }
        }

        public bool TryExecuteAttackImmediately()
        {
            if (!initialized || IsDead || combatTarget == null || targetHealth == null || targetHealth.IsDead)
            {
                return false;
            }

            ExecuteAttack();
            EnterState(ReaverbotRuntimeState.Recovering, Mathf.Max(0.05f, (float)genome.Behavior.RecoveryDuration));
            return true;
        }

        public void Tick(float deltaTime)
        {
            if (!initialized || deltaTime <= 0f) return;
            if (IsDead)
            {
                TickDead(deltaTime);
                return;
            }

            if (health == null || health.IsDead) return;
            attackCooldown = Mathf.Max(0f, attackCooldown - deltaTime);
            AcquireTargetIfNeeded(deltaTime);
            if (combatTarget == null || targetHealth == null || targetHealth.IsDead)
            {
                state = ReaverbotRuntimeState.Dormant;
                rig.SetTelegraph(false);
                UpdateWeakPointExposure();
                return;
            }

            stateTimer += deltaTime;
            Vector3 targetDelta = combatTarget.position - transform.position;
            float flatDistance = new Vector2(targetDelta.x, targetDelta.z).magnitude;
            FaceTarget(targetDelta, deltaTime);

            switch (state)
            {
                case ReaverbotRuntimeState.Dormant:
                    if (flatDistance <= (float)genome.Behavior.AggroRange)
                    {
                        state = ReaverbotRuntimeState.Pursuing;
                        BecameAware?.Invoke(this);
                    }
                    break;

                case ReaverbotRuntimeState.Pursuing:
                    TickPursuit(targetDelta, flatDistance, deltaTime);
                    if (attackCooldown <= 0f && flatDistance <= (float)genome.Stats.AttackRange)
                    {
                        EnterState(
                            ReaverbotRuntimeState.Telegraphing,
                            Mathf.Max(0.08f, (float)genome.Behavior.TelegraphDuration));
                    }
                    break;

                case ReaverbotRuntimeState.Telegraphing:
                    rig.SetTelegraph(true, stateDuration <= 0f ? 1f : stateTimer / stateDuration);
                    if (stateTimer >= stateDuration)
                    {
                        EnterState(
                            ReaverbotRuntimeState.Committing,
                            Mathf.Max(0.02f, (float)genome.Behavior.CommitDuration));
                        ExecuteAttack();
                    }
                    break;

                case ReaverbotRuntimeState.Committing:
                    if (IsMeleeAttack())
                    {
                        TickCommitMovement(targetDelta, deltaTime);
                    }
                    if (stateTimer >= stateDuration)
                    {
                        EnterState(
                            ReaverbotRuntimeState.Recovering,
                            Mathf.Max(0.05f, (float)genome.Behavior.RecoveryDuration));
                    }
                    break;

                case ReaverbotRuntimeState.Recovering:
                    if (stateTimer >= stateDuration)
                    {
                        attackCooldown = Mathf.Max(
                            0.05f,
                            (float)(genome.Stats.AttackCooldown * runtimeCooldownScale));
                        EnterState(ReaverbotRuntimeState.Pursuing, 0f);
                    }
                    break;
            }

            UpdateWeakPointExposure();
        }

        private void Update()
        {
            Tick(Time.deltaTime);
        }

        private void OnDestroy()
        {
            UnbindHealth();
        }

        private void AcquireTargetIfNeeded(float deltaTime)
        {
            if (combatTarget != null && targetHealth != null && !targetHealth.IsDead) return;
            targetSearchTimer -= deltaTime;
            if (targetSearchTimer > 0f) return;
            targetSearchTimer = 0.5f;
            GameObject player = GameObject.FindGameObjectWithTag("Player");
            if (player != null) SetTarget(player.transform);
        }

        private void FaceTarget(Vector3 delta, float deltaTime)
        {
            delta.y = 0f;
            if (delta.sqrMagnitude < 0.0001f) return;
            Quaternion desired = Quaternion.LookRotation(delta.normalized, Vector3.up);
            float degrees = Mathf.Max(45f, (float)genome.Behavior.TurnRate * Mathf.Rad2Deg) * deltaTime;
            transform.rotation = Quaternion.RotateTowards(transform.rotation, desired, degrees);
        }

        private void TickPursuit(Vector3 targetDelta, float flatDistance, float deltaTime)
        {
            float preferred = Mathf.Max((float)genome.Stats.Radius * 2f, (float)genome.Behavior.PreferredRange);
            float error = flatDistance - preferred;
            Vector3 forward = new Vector3(targetDelta.x, 0f, targetDelta.z).normalized;
            Vector3 tangent = Vector3.Cross(Vector3.up, forward) * genome.Behavior.OrbitDirection;
            Vector3 desired = Mathf.Abs(error) > 0.7f
                ? forward * Mathf.Sign(error)
                : tangent * 0.38f;
            Move(desired, (float)genome.Stats.MoveSpeed, deltaTime);
        }

        private void TickCommitMovement(Vector3 targetDelta, float deltaTime)
        {
            Vector3 forward = new Vector3(targetDelta.x, 0f, targetDelta.z).normalized;
            Move(forward, (float)genome.Stats.MoveSpeed * 1.35f, deltaTime);
        }

        private void Move(Vector3 direction, float speed, float deltaTime)
        {
            if (characterController == null || !characterController.enabled || direction.sqrMagnitude < 0.0001f) return;
            Vector3 displacement = direction.normalized * Mathf.Max(0f, speed) * deltaTime;
            if (!aerial && !characterController.isGrounded) displacement.y -= 5.5f * deltaTime;
            characterController.Move(displacement);
        }

        private void EnterState(ReaverbotRuntimeState next, float duration)
        {
            state = next;
            stateTimer = 0f;
            stateDuration = Mathf.Max(0f, duration);
            if (next != ReaverbotRuntimeState.Telegraphing) rig.SetTelegraph(false);
            UpdateWeakPointExposure();
        }

        private void ExecuteAttack()
        {
            if (targetHealth == null || targetHealth.IsDead || combatTarget == null) return;
            attackSequence += 1;
            Vector3 aimOrigin = rig.Muzzle != null ? rig.Muzzle.position : rig.BodyAim.position;
            Vector3 aimDestination = ResolveTargetAimPoint();
            Vector3 direction = aimDestination - aimOrigin;
            if (direction.sqrMagnitude < 0.0001f) direction = transform.forward;
            direction.Normalize();

            var packet = new DamagePacket(
                genome.Stats.Damage * runtimeDamageScale,
                StableSpawnId + ":attack:" + attackSequence,
                StableSpawnId,
                genome.SchemaVersion,
                null,
                0d,
                genome.ThreatTier * 0.18d,
                false,
                DamageElement.Neutral,
                new DoubleVector3(direction.x * 2.5d, 0.45d, direction.z * 2.5d),
                false);

            if (IsRangedAttack())
            {
                ProductionProjectile projectile = projectilePool != null ? projectilePool.Lease() : null;
                if (projectile == null)
                {
                    Debug.LogWarning("[RuinCrawler Reaverbot] Enemy projectile reservation was unavailable for " + StableSpawnId, this);
                    return;
                }

                float speed = (float)(genome.Modules.Weapon.Definition.ProjectileSpeed ?? 12d);
                float radius = Mathf.Clamp((float)genome.Stats.Radius * 0.17f, 0.08f, 0.3f);
                projectile.Initialize(
                    aimOrigin + direction * (radius + 0.05f),
                    direction,
                    speed,
                    radius,
                    Mathf.Max(1f, (float)genome.Stats.AttackRange),
                    packet);
                return;
            }

            float distance = Vector3.Distance(transform.position, combatTarget.position);
            if (distance <= (float)genome.Stats.AttackRange + (float)genome.Stats.Radius)
            {
                targetHealth.ApplyDamage(packet);
            }
        }

        private Vector3 ResolveTargetAimPoint()
        {
            CombatTargetComponent targetComponent = combatTarget.GetComponentInChildren<CombatTargetComponent>();
            return targetComponent != null ? targetComponent.AimTransform.position : combatTarget.position + Vector3.up;
        }

        private bool IsMeleeAttack()
        {
            return genome.Modules.Weapon.HasTag("melee")
                || genome.Modules.Weapon.AttackKind == "charge"
                || genome.Modules.Weapon.AttackKind == "pounce"
                || genome.Modules.Weapon.AttackKind == "shockwave";
        }

        private bool IsRangedAttack()
        {
            return genome.Modules.Weapon.HasTag("ranged")
                || genome.Modules.Weapon.AttackKind == "electricOrb"
                || genome.Modules.Weapon.AttackKind == "tractorBeam";
        }

        private void UpdateWeakPointExposure()
        {
            if (genome?.Modules?.WeakPoint == null || weakPointTarget == null || weakPointCollider == null) return;
            string exposure = genome.Modules.WeakPoint.Exposure;
            bool exposed = exposure == "always"
                || (exposure == "telegraph" && state == ReaverbotRuntimeState.Telegraphing)
                || (exposure == "attack" && (state == ReaverbotRuntimeState.Telegraphing || state == ReaverbotRuntimeState.Committing))
                || (exposure == "recovery" && state == ReaverbotRuntimeState.Recovering);
            if (state == ReaverbotRuntimeState.Dead) exposed = false;
            weakPointTarget.SetTargetActive(exposed && genome.Modules.WeakPoint.Lockable);
            weakPointCollider.enabled = exposed && genome.Modules.WeakPoint.Lockable;
            rig.SetWeakPointExposed(exposed);
        }

        private void HandleDamaged(DamageResult result)
        {
            if (result?.TargetDied == true)
            {
                lethalPacketRecoverySuppressed = result.Packet.SuppressRewards;
            }
        }

        private void HandleDied(HealthSnapshot _)
        {
            if (deathHandled) return;
            deathHandled = true;
            state = ReaverbotRuntimeState.Dead;
            deadTimer = 0f;
            rig.SetTelegraph(false);
            bodyTarget.SetTargetActive(false);
            weakPointTarget.SetTargetActive(false);
            if (weakPointCollider != null) weakPointCollider.enabled = false;
            if (characterController != null) characterController.enabled = false;

            UnidentifiedReaverbotRecovery recovery = null;
            if (!encounterRecoverySuppressed && !lethalPacketRecoverySuppressed)
            {
                IReadOnlyList<ReaverbotSalvageCandidate> candidates = ReaverbotSalvageProfile.Create(
                    genome,
                    salvageCatalog);
                recovery = new UnidentifiedReaverbotRecovery(
                    StableSpawnId + ":recovery:0",
                    genome.GenomeId,
                    StableSpawnId,
                    candidates);
            }
            Died?.Invoke(this, recovery);
        }

        private void TickDead(float deltaTime)
        {
            deadTimer += deltaTime;
            rig.SetDeathPose(deadTimer / 0.72f);
            if (automaticDespawn && deadTimer >= 1.15f)
            {
                initialized = false;
                DespawnRequested?.Invoke(this);
            }
        }

        private void UnbindHealth()
        {
            if (health == null) return;
            health.Damaged -= HandleDamaged;
            health.Died -= HandleDied;
        }
    }
}
