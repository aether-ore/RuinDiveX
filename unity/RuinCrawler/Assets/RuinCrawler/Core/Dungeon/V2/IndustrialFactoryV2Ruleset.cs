namespace RuinCrawler.Core.Dungeon.V2
{
    public static class IndustrialFactoryV2Ruleset
    {
        public const int MaximumGenerationAttempts = 12;
        public const int MaximumVariantBacktracksPerAttempt = 255;
        public const int ContractVersion = 3;
        public const double MaximumCertifiedPhysicalTransition = 8.1d;
        public const string RulesetVersion = "industrial-factory-v2";
        public const string ProfileId = "industrial-factory-v2";
        public const string ContentPackVersion = "industrial-factory-v2-contracts-v4-authored-composition";
        public const string FactoryDistrictId = "district-factory";
        public const string WaterworksDistrictId = "district-waterworks";
        public const string HazardDistrictId = "district-hazard-undercroft";
        public const string WaterNetworkId = "waterworks-network";
        public const string WaterRoutingControllerId = "water-routing-controller";
        public const string ValveUnlockControllerId = "water-valve-unlock-controller";
        public const string HazardControllerId = "hazard-undercroft-controller";
        public const string CredentialCrumbleControllerId = "credential-tower-crumble-controller";
        public const string CredentialCrumbleSurfaceId = "surface-credential-tower-crumble";
        public const string ReservoirMovingPlatformSurfaceId = "surface-water-reservoir-moving-platform";
        public const string ReservoirMovingCatchmentSurfaceId = "surface-water-reservoir-moving-catchment";
        public const string FreightSumpFilled = "FreightSumpFilled";
        public const string StoredInReservoir = "StoredInReservoir";
        public const string GantrySumpFilled = "GantrySumpFilled";
        public const string CredentialKeyRewardId = "credential-key";
        public const string CredentialKeyDiscoveryId = "discovery-credential-key";
        public const string CredentialGateEdgeId = "edge-factory-5-6";
        public const string CoolingFinArrayRewardId = "coolingFinArray";
        public const string HeatResistChipRewardId = "heatResistChip";
        public const string AncientBatteryPackRewardId = "ancientBatteryPack";
        public const string WaterworksShortcutId = "waterworks-warehouse-shortcut";
        public const string FinalEliteDefeatedFactId = "machine-core-guardian-defeated";
        public const string LargeRefractorDiscoveryId = "large-refractor";
        public const string ExtractionReadyFactId = "large-refractor-secured";
        public const string TraversalProfileVersion = "traversal-v2";
        public const string ReactionEnvelopeId = "player-knockback-v1";

        public static bool IsAllowedTraversalCapability(string id)
        {
            return string.Equals(id, TraversalProfilesV2.DryId, System.StringComparison.Ordinal)
                || string.Equals(id, TraversalProfilesV2.FloodedId, System.StringComparison.Ordinal);
        }
    }
}
