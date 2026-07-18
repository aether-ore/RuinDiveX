using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    public sealed class PrototypeProjectile : MonoBehaviour
    {
        [SerializeField] private float speed = SourceGameplayContract.MegaBusterSpeed;
        [SerializeField] private float damage = SourceGameplayContract.MegaBusterDamage;
        [SerializeField] private float radius = SourceGameplayContract.MegaBusterRadius;
        [SerializeField] private float remainingRange = SourceGameplayContract.MegaBusterRange;
        private Vector3 direction = Vector3.forward;

        public Vector3 Direction => direction;

        public void Initialize(Vector3 forward, float projectileDamage)
        {
            direction = forward.sqrMagnitude > 0.0001f ? forward.normalized : Vector3.forward;
            damage = Mathf.Max(0f, projectileDamage);
        }

        private void Update()
        {
            float distance = Mathf.Min(speed * Time.deltaTime, remainingRange);
            if (Physics.SphereCast(
                    transform.position,
                    radius,
                    direction,
                    out RaycastHit hit,
                    distance,
                    Physics.DefaultRaycastLayers,
                    QueryTriggerInteraction.Ignore))
            {
                PrototypeDamageTarget target = hit.collider.GetComponentInParent<PrototypeDamageTarget>();
                if (target != null)
                {
                    target.TakeDamage(damage);
                }

                Destroy(gameObject);
                return;
            }

            transform.position += direction * distance;
            remainingRange -= distance;
            if (remainingRange <= 0f)
            {
                Destroy(gameObject);
            }
        }
    }
}
