using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Persistence;
using UnityEngine;

namespace RuinCrawler.Runtime.Player
{
    /// <summary>
    /// Narrow fixed-function Gear consumer for environmental hazards. The
    /// dungeon never infers protection from colors or armor values; it matches
    /// the equipped Gear effect's stable domain and semantic hazard tags.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlayerEnvironmentalProtection : MonoBehaviour, IDamageMitigationPolicy
    {
        private const string HeatResistGearId = "heatResistChip";

        public bool TryMitigate(DamagePacket packet, out DamageMitigationDecision decision)
        {
            decision = default;
            if (packet == null || !IsEquipped(HeatResistGearId))
            {
                return false;
            }

            UnityContractCatalog catalog = UnityContractCatalogProvider.Instance?.Catalog;
            if (catalog == null
                || !catalog.GearEffects.TryGetValue(
                    HeatResistGearId,
                    out UnityContractCatalog.FixedGearEffectContract effect)
                || !string.Equals(effect.EffectId, "hazardImmunity", StringComparison.Ordinal)
                || !string.Equals(packet.DamageDomain, effect.HazardDomain, StringComparison.Ordinal))
            {
                return false;
            }

            for (int index = 0; index < packet.HazardTags.Count; index += 1)
            {
                if (!Contains(effect.HazardTags, packet.HazardTags[index]))
                {
                    continue;
                }

                decision = DamageMitigationDecision.Immune("gear:" + HeatResistGearId);
                return true;
            }

            return false;
        }

        private static bool Contains(System.Collections.Generic.IReadOnlyList<string> values, string value)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.Equals(values[index], value, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool IsEquipped(string gearId)
        {
            CampaignStateV1 state = CampaignSession.Instance?.Snapshot;
            if (state?.gearAssignments == null)
            {
                return false;
            }

            for (int index = 0; index < state.gearAssignments.Count; index += 1)
            {
                if (string.Equals(
                    state.gearAssignments[index]?.itemId,
                    gearId,
                    StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
