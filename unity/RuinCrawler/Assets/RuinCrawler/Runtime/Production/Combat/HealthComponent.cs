using System;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    /// <summary>
    /// Unity boundary for the authoritative, engine-independent HealthState.
    /// Rendering and collision are presentation concerns and are changed only
    /// after the durable death event has been emitted.
    /// </summary>
    public sealed class HealthComponent : MonoBehaviour
    {
        [SerializeField, Min(1f)] private float maximumHealth = 160f;
        [SerializeField, Min(0f)] private float armor;
        [SerializeField] private bool disablePresentationOnDeath;
        [SerializeField] private Renderer[] ownedRenderers;
        [SerializeField] private Collider[] ownedColliders;

        private HealthState state;

        public event Action<HealthSnapshot> HealthChanged;
        public event Action<DamageResult> Damaged;
        public event Action<HealthSnapshot> Died;

        public HealthSnapshot Snapshot => EnsureState().Snapshot;
        public bool IsDead => EnsureState().IsDead;
        public double Armor => armor;

        public void Configure(float maximum, float targetArmor = 0f, bool hideOnDeath = false)
        {
            maximumHealth = Mathf.Max(1f, maximum);
            armor = Mathf.Max(0f, targetArmor);
            disablePresentationOnDeath = hideOnDeath;
            UnbindState();
            state = new HealthState(maximumHealth);
            BindState();
            CachePresentation();
            SetPresentationEnabled(true);
            HealthChanged?.Invoke(state.Snapshot);
        }

        public DamageResult ApplyDamage(DamagePacket packet)
        {
            DamageMitigationDecision? mitigation = ResolveMitigation(packet);
            return EnsureState().ApplyDamage(packet, armor, mitigation);
        }

        public HealthHealResult Heal(double amount)
        {
            return EnsureState().Heal(amount);
        }

        public void RestoreFullHealth()
        {
            SetPresentationEnabled(true);
            EnsureState().Reset();
        }

        private void Awake()
        {
            CachePresentation();
            EnsureState();
        }

        private void OnDestroy()
        {
            UnbindState();
        }

        private HealthState EnsureState()
        {
            if (state != null)
            {
                return state;
            }

            state = new HealthState(Math.Max(1d, maximumHealth));
            BindState();
            return state;
        }

        private void BindState()
        {
            state.Damaged += HandleDamaged;
            state.Changed += HandleChanged;
            state.Died += HandleDied;
        }

        private void UnbindState()
        {
            if (state == null)
            {
                return;
            }

            state.Damaged -= HandleDamaged;
            state.Changed -= HandleChanged;
            state.Died -= HandleDied;
        }

        private void HandleDamaged(DamageResult result)
        {
            Damaged?.Invoke(result);
        }

        private void HandleChanged(HealthChange change)
        {
            HealthChanged?.Invoke(change.Current);
        }

        private void HandleDied(HealthSnapshot snapshot)
        {
            Died?.Invoke(snapshot);
            if (disablePresentationOnDeath)
            {
                SetPresentationEnabled(false);
            }
        }

        private DamageMitigationDecision? ResolveMitigation(DamagePacket packet)
        {
            if (packet == null)
            {
                return null;
            }

            MonoBehaviour[] behaviours = GetComponentsInParent<MonoBehaviour>(true);
            for (int index = 0; index < behaviours.Length; index += 1)
            {
                if (behaviours[index] is IDamageMitigationPolicy policy
                    && policy.TryMitigate(packet, out DamageMitigationDecision decision))
                {
                    return decision;
                }
            }

            return null;
        }

        private void CachePresentation()
        {
            if (ownedRenderers == null || ownedRenderers.Length == 0)
            {
                ownedRenderers = GetComponentsInChildren<Renderer>(true);
            }

            if (ownedColliders == null || ownedColliders.Length == 0)
            {
                ownedColliders = GetComponentsInChildren<Collider>(true);
            }
        }

        private void SetPresentationEnabled(bool value)
        {
            CachePresentation();
            foreach (Renderer targetRenderer in ownedRenderers)
            {
                if (targetRenderer != null)
                {
                    targetRenderer.enabled = value;
                }
            }

            foreach (Collider targetCollider in ownedColliders)
            {
                if (targetCollider != null)
                {
                    targetCollider.enabled = value;
                }
            }
        }
    }
}
