using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    public sealed class CombatTargetComponent : MonoBehaviour
    {
        [SerializeField] private string targetId = "target.body";
        [SerializeField] private string ownerId = "target.body";
        [SerializeField] private string displayName = "Target";
        [SerializeField] private string partLabel;
        [SerializeField] private CombatTargetKind kind = CombatTargetKind.Body;
        [SerializeField] private Transform aimPoint;
        [SerializeField, Min(0.01f)] private float lockRadius = 0.7f;
        [SerializeField, Min(0f)] private float damageMultiplier = 1f;
        [SerializeField] private bool targetActive = true;
        [SerializeField] private bool retainLockWhenInactive;
        [SerializeField] private string fallbackTargetId;
        [SerializeField] private HealthComponent ownerHealth;

        private CombatWorld world;
        private CombatTargetId parsedTargetId;
        private CombatTargetId parsedOwnerId;

        public CombatTargetId TargetId => parsedTargetId;
        public CombatTargetId OwnerId => parsedOwnerId;
        public HealthComponent OwnerHealth => ownerHealth;
        public Transform AimTransform => aimPoint != null ? aimPoint : transform;
        public bool IsTargetActive => targetActive;
        public string DisplayName => displayName;
        public string PartLabel => partLabel;
        public CombatTargetKind Kind => kind;

        public void Configure(
            string stableTargetId,
            string stableOwnerId,
            string targetDisplayName,
            HealthComponent health,
            Transform targetAimPoint = null,
            CombatTargetKind targetKind = CombatTargetKind.Body,
            string targetPartLabel = null,
            float targetLockRadius = 0.7f,
            bool retainWhenInactive = false,
            string fallbackId = null,
            float targetDamageMultiplier = 1f)
        {
            targetId = stableTargetId;
            ownerId = stableOwnerId;
            displayName = targetDisplayName;
            ownerHealth = health;
            aimPoint = targetAimPoint;
            kind = targetKind;
            partLabel = targetPartLabel;
            lockRadius = Mathf.Max(0.01f, targetLockRadius);
            retainLockWhenInactive = retainWhenInactive;
            fallbackTargetId = fallbackId;
            damageMultiplier = Mathf.Max(0f, targetDamageMultiplier);
            ParseIds();
            Publish();
        }

        public DamageResult ApplyDamage(DamagePacket packet)
        {
            if (ownerHealth == null || packet == null)
            {
                return null;
            }

            var resolved = new DamagePacket(
                packet.Amount * damageMultiplier,
                packet.ExecutionId,
                packet.SourceId,
                packet.BuildRevision,
                string.IsNullOrWhiteSpace(partLabel) ? targetId : targetId + ":" + partLabel,
                packet.ArmorPierce,
                packet.Stagger,
                packet.IsCritical,
                packet.Element,
                packet.Knockback,
                packet.SuppressRewards,
                packet.DamageDomain,
                packet.HazardTags,
                packet.ReactionEnvelopeId);
            return ownerHealth.ApplyDamage(resolved);
        }

        public void SetTargetActive(bool value)
        {
            targetActive = value;
            Publish();
        }

        public CombatTargetDescriptor CreateDescriptor()
        {
            ParseIds();
            Vector3 position = AimTransform.position;
            CombatTargetId? fallback = CombatTargetId.TryCreate(fallbackTargetId, out CombatTargetId parsedFallback)
                ? parsedFallback
                : (CombatTargetId?)null;
            return new CombatTargetDescriptor(
                parsedTargetId,
                parsedOwnerId,
                string.IsNullOrWhiteSpace(displayName) ? gameObject.name : displayName,
                kind,
                new DoubleVector3(position.x, position.y, position.z),
                lockRadius,
                targetActive,
                ownerHealth != null && ownerHealth.IsDead,
                retainLockWhenInactive,
                fallback,
                partLabel);
        }

        private void Awake()
        {
            if (ownerHealth == null)
            {
                ownerHealth = GetComponentInParent<HealthComponent>();
            }

            ParseIds();
        }

        private void OnEnable()
        {
            world = CombatWorld.GetOrCreate();
            if (ownerHealth != null)
            {
                ownerHealth.HealthChanged += HandleHealthChanged;
            }

            Publish();
        }

        private void LateUpdate()
        {
            world?.Refresh(this, CreateDescriptor());
        }

        private void OnDisable()
        {
            if (ownerHealth != null)
            {
                ownerHealth.HealthChanged -= HandleHealthChanged;
            }

            world?.Unregister(this, parsedTargetId);
        }

        private void Publish()
        {
            if (!isActiveAndEnabled)
            {
                return;
            }

            world ??= CombatWorld.GetOrCreate();
            world.Register(this, CreateDescriptor());
        }

        private void ParseIds()
        {
            string safeTarget = string.IsNullOrWhiteSpace(targetId) ? gameObject.name + ".body" : targetId.Trim();
            string safeOwner = string.IsNullOrWhiteSpace(ownerId) ? safeTarget : ownerId.Trim();
            parsedTargetId = new CombatTargetId(safeTarget);
            parsedOwnerId = new CombatTargetId(safeOwner);
        }

        private void HandleHealthChanged(HealthSnapshot _)
        {
            Publish();
        }
    }
}
