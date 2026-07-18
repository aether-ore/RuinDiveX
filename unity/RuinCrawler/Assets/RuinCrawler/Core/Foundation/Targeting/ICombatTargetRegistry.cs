using System.Collections.Generic;

namespace RuinCrawler.Core.Foundation
{
    public interface ICombatTargetRegistry
    {
        int Count { get; }

        bool TryGet(CombatTargetId targetId, out CombatTargetDescriptor descriptor);

        bool TryResolveRetainable(
            CombatTargetId requestedTargetId,
            out CombatTargetDescriptor descriptor);

        bool TryGetOwner(
            CombatTargetId targetId,
            out CombatTargetDescriptor ownerDescriptor);

        IReadOnlyList<CombatTargetDescriptor> GetSnapshot();
    }
}
