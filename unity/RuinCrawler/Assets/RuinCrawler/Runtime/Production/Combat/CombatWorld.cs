using System;
using System.Collections.Generic;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    /// <summary>
    /// Scene adapter for the pure target registry. Runtime components are held
    /// separately so the deterministic registry never owns Unity objects.
    /// </summary>
    [DefaultExecutionOrder(-500)]
    public sealed class CombatWorld : MonoBehaviour
    {
        private static CombatWorld instance;
        private readonly CombatTargetRegistry registry = new CombatTargetRegistry();
        private readonly Dictionary<CombatTargetId, CombatTargetComponent> components =
            new Dictionary<CombatTargetId, CombatTargetComponent>();

        public static CombatWorld Instance => instance;
        public CombatTargetRegistry Registry => registry;
        public event Action TargetsChanged;

        public static CombatWorld GetOrCreate()
        {
            if (instance != null)
            {
                return instance;
            }

            instance = FindAnyObjectByType<CombatWorld>();
            if (instance != null)
            {
                return instance;
            }

            var root = new GameObject("CombatWorld");
            instance = root.AddComponent<CombatWorld>();
            return instance;
        }

        public void Register(CombatTargetComponent component, CombatTargetDescriptor descriptor)
        {
            if (component == null || descriptor == null)
            {
                throw new ArgumentNullException(component == null ? nameof(component) : nameof(descriptor));
            }

            components[descriptor.TargetId] = component;
            registry.Upsert(descriptor);
            TargetsChanged?.Invoke();
        }

        public void Refresh(CombatTargetComponent component, CombatTargetDescriptor descriptor)
        {
            if (component == null || descriptor == null)
            {
                return;
            }

            components[descriptor.TargetId] = component;
            registry.Upsert(descriptor);
        }

        public void Unregister(CombatTargetComponent component, CombatTargetId targetId)
        {
            if (components.TryGetValue(targetId, out CombatTargetComponent current) && current == component)
            {
                components.Remove(targetId);
                registry.Remove(targetId);
                TargetsChanged?.Invoke();
            }
        }

        public bool TryGetComponent(CombatTargetId id, out CombatTargetComponent component)
        {
            return components.TryGetValue(id, out component) && component != null;
        }

        public IReadOnlyList<CombatTargetComponent> GetComponentsSnapshot()
        {
            var result = new List<CombatTargetComponent>(components.Values);
            result.RemoveAll(component => component == null);
            result.Sort((left, right) => string.CompareOrdinal(left.TargetId.Value, right.TargetId.Value));
            return result;
        }

        private void Awake()
        {
            if (instance != null && instance != this)
            {
                Destroy(gameObject);
                return;
            }

            instance = this;
        }

        private void OnDestroy()
        {
            if (instance == this)
            {
                instance = null;
            }
        }
    }
}
