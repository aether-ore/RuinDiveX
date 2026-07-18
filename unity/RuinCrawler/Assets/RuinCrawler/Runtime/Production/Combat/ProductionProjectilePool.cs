using System.Collections.Generic;
using System;
using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    public sealed class ProductionProjectilePool : MonoBehaviour
    {
        [SerializeField] private Material projectileMaterial;
        [SerializeField, Min(1)] private int capacity = 24;
        [SerializeField] private LayerMask collisionMask = ~0;

        private readonly Stack<ProductionProjectile> available = new Stack<ProductionProjectile>();
        private readonly HashSet<ProductionProjectile> active = new HashSet<ProductionProjectile>();

        public int ActiveCount => active.Count;
        public int Capacity => capacity;

        public void Configure(Material material, LayerMask mask, int maximum = 24)
        {
            projectileMaterial = material;
            collisionMask = mask;
            capacity = Mathf.Max(1, maximum);
        }

        public ProductionProjectile Lease()
        {
            ProductionProjectile projectile = available.Count > 0 ? available.Pop() : null;
            if (projectile == null)
            {
                if (active.Count >= capacity)
                {
                    return null;
                }

                projectile = CreateProjectile();
            }

            active.Add(projectile);
            projectile.gameObject.SetActive(true);
            return projectile;
        }

        public void Return(ProductionProjectile projectile)
        {
            if (projectile == null || !active.Remove(projectile))
            {
                return;
            }

            projectile.gameObject.SetActive(false);
            projectile.transform.SetParent(transform, false);
            available.Push(projectile);
        }

        public int CancelBySource(string sourceId)
        {
            if (string.IsNullOrWhiteSpace(sourceId) || active.Count == 0)
            {
                return 0;
            }

            var snapshot = new List<ProductionProjectile>(active);
            snapshot.Sort((left, right) => string.CompareOrdinal(
                left != null ? left.ExecutionId : string.Empty,
                right != null ? right.ExecutionId : string.Empty));
            int cancelled = 0;
            foreach (ProductionProjectile projectile in snapshot)
            {
                if (projectile != null && string.Equals(projectile.SourceId, sourceId, StringComparison.Ordinal))
                {
                    projectile.Cancel();
                    cancelled += 1;
                }
            }
            return cancelled;
        }

        public int CancelAll()
        {
            var snapshot = new List<ProductionProjectile>(active);
            snapshot.Sort((left, right) => string.CompareOrdinal(
                left != null ? left.ExecutionId : string.Empty,
                right != null ? right.ExecutionId : string.Empty));
            foreach (ProductionProjectile projectile in snapshot)
            {
                projectile?.Cancel();
            }
            return snapshot.Count;
        }

        private void Awake()
        {
            for (int index = 0; index < Mathf.Min(capacity, 8); index += 1)
            {
                ProductionProjectile projectile = CreateProjectile();
                projectile.gameObject.SetActive(false);
                available.Push(projectile);
            }
        }

        private ProductionProjectile CreateProjectile()
        {
            GameObject projectileObject = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            projectileObject.name = "BusterProjectile_Pooled";
            projectileObject.transform.SetParent(transform, false);
            projectileObject.transform.localScale = Vector3.one * (SourceGameplayContract.MegaBusterRadius * 2f);
            Collider primitiveCollider = projectileObject.GetComponent<Collider>();
            if (primitiveCollider != null)
            {
                Destroy(primitiveCollider);
            }

            Renderer projectileRenderer = projectileObject.GetComponent<Renderer>();
            if (projectileRenderer != null && projectileMaterial != null)
            {
                projectileRenderer.sharedMaterial = projectileMaterial;
            }

            var projectile = projectileObject.AddComponent<ProductionProjectile>();
            projectile.Configure(this, collisionMask);
            return projectile;
        }
    }
}
