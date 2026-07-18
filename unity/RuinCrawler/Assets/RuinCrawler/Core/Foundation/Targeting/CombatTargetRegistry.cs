using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Foundation
{
    /// <summary>
    /// Stable-id registry used by lock-on and projectile adapters. Broken or
    /// disposed parts resolve through an explicit fallback, then their owner.
    /// </summary>
    public sealed class CombatTargetRegistry : ICombatTargetRegistry
    {
        private readonly Dictionary<CombatTargetId, CombatTargetDescriptor> _targets =
            new Dictionary<CombatTargetId, CombatTargetDescriptor>();

        public int Count => _targets.Count;

        public bool TryRegister(CombatTargetDescriptor descriptor)
        {
            if (descriptor == null)
            {
                throw new ArgumentNullException(nameof(descriptor));
            }

            if (_targets.ContainsKey(descriptor.TargetId))
            {
                return false;
            }

            _targets.Add(descriptor.TargetId, descriptor);
            return true;
        }

        public void Upsert(CombatTargetDescriptor descriptor)
        {
            if (descriptor == null)
            {
                throw new ArgumentNullException(nameof(descriptor));
            }

            _targets[descriptor.TargetId] = descriptor;
        }

        public bool Remove(CombatTargetId targetId)
        {
            return !targetId.IsEmpty && _targets.Remove(targetId);
        }

        public void Clear()
        {
            _targets.Clear();
        }

        public bool TryGet(CombatTargetId targetId, out CombatTargetDescriptor descriptor)
        {
            if (targetId.IsEmpty)
            {
                descriptor = null;
                return false;
            }

            return _targets.TryGetValue(targetId, out descriptor);
        }

        public bool TryResolveRetainable(
            CombatTargetId requestedTargetId,
            out CombatTargetDescriptor descriptor)
        {
            descriptor = null;
            if (requestedTargetId.IsEmpty)
            {
                return false;
            }

            var visited = new HashSet<CombatTargetId>();
            CombatTargetId candidateId = requestedTargetId;
            while (!candidateId.IsEmpty && visited.Add(candidateId))
            {
                if (!_targets.TryGetValue(candidateId, out CombatTargetDescriptor candidate))
                {
                    return false;
                }

                if (candidate.IsLockRetainable)
                {
                    descriptor = candidate;
                    return true;
                }

                CombatTargetId? next = candidate.FallbackTargetId;
                if (!next.HasValue && candidate.OwnerId != candidate.TargetId)
                {
                    next = candidate.OwnerId;
                }

                if (!next.HasValue)
                {
                    return false;
                }

                candidateId = next.Value;
            }

            return false;
        }

        public bool TryGetOwner(
            CombatTargetId targetId,
            out CombatTargetDescriptor ownerDescriptor)
        {
            ownerDescriptor = null;
            return TryGet(targetId, out CombatTargetDescriptor target)
                && TryGet(target.OwnerId, out ownerDescriptor);
        }

        public IReadOnlyList<CombatTargetDescriptor> GetSnapshot()
        {
            var snapshot = new List<CombatTargetDescriptor>(_targets.Values);
            snapshot.Sort((left, right) => left.TargetId.CompareTo(right.TargetId));
            return snapshot.ToArray();
        }
    }
}
