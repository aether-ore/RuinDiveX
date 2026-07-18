using System;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    public sealed class ProductionProjectile : MonoBehaviour
    {
        private ProductionProjectilePool ownerPool;
        private LayerMask collisionMask;
        private Vector3 direction;
        private float speed;
        private float radius;
        private float remainingRange;
        private DamagePacket damagePacket;
        private Action<ProductionProjectile> finished;
        private bool live;

        public Vector3 Direction => direction;
        public string ExecutionId => damagePacket?.ExecutionId;
        public string SourceId => damagePacket?.SourceId;

        public void Configure(ProductionProjectilePool pool, LayerMask mask)
        {
            ownerPool = pool;
            collisionMask = mask;
        }

        public void Initialize(
            Vector3 position,
            Vector3 forward,
            float projectileSpeed,
            float projectileRadius,
            float range,
            DamagePacket packet,
            Action<ProductionProjectile> onFinished = null)
        {
            transform.SetPositionAndRotation(
                position,
                Quaternion.LookRotation(forward.sqrMagnitude > 0.0001f ? forward.normalized : Vector3.forward));
            direction = forward.sqrMagnitude > 0.0001f ? forward.normalized : Vector3.forward;
            speed = Mathf.Max(0f, projectileSpeed);
            radius = Mathf.Max(0.001f, projectileRadius);
            remainingRange = Mathf.Max(0f, range);
            damagePacket = packet ?? throw new ArgumentNullException(nameof(packet));
            finished = onFinished;
            transform.localScale = Vector3.one * radius * 2f;
            live = true;
        }

        public void Cancel()
        {
            if (live)
            {
                Finish();
            }
        }

        private void Update()
        {
            if (!live)
            {
                return;
            }

            float distance = Mathf.Min(speed * Time.deltaTime, remainingRange);
            if (distance <= 0f)
            {
                Finish();
                return;
            }

            RaycastHit[] hits = Physics.SphereCastAll(
                transform.position,
                radius,
                direction,
                distance,
                collisionMask,
                QueryTriggerInteraction.Ignore);
            if (hits.Length > 0)
            {
                Array.Sort(hits, CompareHits);
                RaycastHit hit = hits[0];
                CombatTargetComponent target = hit.collider.GetComponentInParent<CombatTargetComponent>();
                target?.ApplyDamage(damagePacket);
                transform.position += direction * Mathf.Max(0f, hit.distance);
                Finish();
                return;
            }

            transform.position += direction * distance;
            remainingRange -= distance;
            if (remainingRange <= 0f)
            {
                Finish();
            }
        }

        private static int CompareHits(RaycastHit left, RaycastHit right)
        {
            int distanceComparison = left.distance.CompareTo(right.distance);
            if (distanceComparison != 0)
            {
                return distanceComparison;
            }

            CombatTargetComponent leftTarget = left.collider.GetComponentInParent<CombatTargetComponent>();
            CombatTargetComponent rightTarget = right.collider.GetComponentInParent<CombatTargetComponent>();
            return string.CompareOrdinal(leftTarget?.TargetId.Value ?? string.Empty, rightTarget?.TargetId.Value ?? string.Empty);
        }

        private void Finish()
        {
            live = false;
            damagePacket = null;
            Action<ProductionProjectile> callback = finished;
            finished = null;
            ownerPool?.Return(this);
            callback?.Invoke(this);
        }
    }
}
