using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    public sealed class PrototypeDamageTarget : MonoBehaviour
    {
        [SerializeField, Min(1f)] private float maximumHealth = SourceGameplayContract.SharukurusuHealth;
        [SerializeField] private float currentHealth;
        [SerializeField] private Renderer[] renderers;

        public float CurrentHealth => currentHealth;
        public float MaximumHealth => maximumHealth;
        public bool IsDefeated => currentHealth <= 0f;

        private void Awake()
        {
            currentHealth = maximumHealth;
            if (renderers == null || renderers.Length == 0)
            {
                renderers = GetComponentsInChildren<Renderer>(true);
            }
        }

        public void Configure(float health)
        {
            maximumHealth = Mathf.Max(1f, health);
            currentHealth = maximumHealth;
            renderers = GetComponentsInChildren<Renderer>(true);
        }

        public void TakeDamage(float amount)
        {
            if (IsDefeated || amount <= 0f)
            {
                return;
            }

            currentHealth = Mathf.Max(0f, currentHealth - amount);
            if (!IsDefeated)
            {
                return;
            }

            foreach (Renderer targetRenderer in renderers)
            {
                if (targetRenderer != null)
                {
                    targetRenderer.enabled = false;
                }
            }

            foreach (Collider targetCollider in GetComponentsInChildren<Collider>())
            {
                targetCollider.enabled = false;
            }
        }
    }
}
