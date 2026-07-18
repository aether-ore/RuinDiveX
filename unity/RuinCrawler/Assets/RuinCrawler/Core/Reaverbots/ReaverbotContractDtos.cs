using System;

namespace RuinCrawler.Core.Reaverbots
{
    /// <summary>
    /// Loader-facing projection of the relevant sections in
    /// ruin-crawler-contracts.v1.json. Fields intentionally retain their JSON
    /// spelling so Unity JsonUtility can populate the DTO without attributes.
    /// Unknown top-level contract sections are ignored by that loader.
    /// </summary>
    [Serializable]
    public sealed class RuinCrawlerContractPackDto
    {
        public int contractVersion;
        public ReaverbotCatalogDto reaverbots;
        public ReaverbotSalvageCatalogDto salvage;
    }

    [Serializable]
    public sealed class ReaverbotCatalogDto
    {
        public int schemaVersion;
        public uint eyeColor;
        public ReaverbotArchetypeRecord[] archetypes;
        public ReaverbotBodyPlanRecord[] bodyPlans;
        public ReaverbotWeaponRecord[] weapons;
        public ReaverbotChargeModuleRecord[] chargeModules;
        public ReaverbotDefenseRecord[] defenses;
        public ReaverbotWeakPointRecord[] weakPoints;
        public ReaverbotPaletteRecord[] palettes;
        public ReaverbotIntentWeightsRecord[] intentArchetypeWeights;
        public ReaverbotLinkedWeakPointWeightsRecord[] linkedWeakPointWeights;
    }

    [Serializable]
    public sealed class ReaverbotArchetypeRecord
    {
        public string id;
        public string label;
        public string role;
        public string[] bodyPlans;
        public string[] weapons;
        public string[] defenses;
        public string[] weakPoints;
        public string paletteId;
        public ReaverbotBaseStatsRecord baseStats;
        public ReaverbotArchetypeBehaviorRecord behavior;
        public int threatCost;
    }

    [Serializable]
    public sealed class ReaverbotBaseStatsRecord
    {
        public double health;
        public double damage;
        public double speed;
        public double armor;
        public double radius;
    }

    [Serializable]
    public sealed class ReaverbotArchetypeBehaviorRecord
    {
        public double preferredRange;
        public double aggroRange;
        public double telegraph;
        public double commit;
        public double recovery;
        public double turnRate;
        public int minimumPackSize;
        public double flankApproachDistance;
        public double flankRearBiasMin;
        public double flankRearBiasMax;
        public double flankAttackDot;
        public double flankPursuitSpeedScale;
        public double attackCooldownScale;
        public double attackCooldownFloor;
        public double forcedAttackSeconds;
    }

    [Serializable]
    public sealed class ReaverbotBodyPlanRecord
    {
        public string id;
        public string label;
        public string[] tags;
        public double height;
        public double radiusScale;
        public double hoverHeight;
    }

    /// <summary>
    /// Complete union of weapon fields currently exported by schema 3. A zero
    /// optional number means the property was absent in the source record;
    /// every optional numeric property consumed by generation is positive in
    /// the frozen catalog, so this representation is unambiguous there.
    /// </summary>
    [Serializable]
    public sealed class ReaverbotWeaponRecord
    {
        public string id;
        public string label;
        public string[] tags;
        public string[] requires;
        public string[] requiresAny;
        public string[] bodyPlans;
        public string attackKind;
        public double range;
        public double damageScale;
        public double threatCost;
        public double preferredRange;
        public double projectileSpeed;
        public double explosiveRadius;
        public double telegraphDuration;
        public double commitDuration;
        public double recoveryDuration;
        public double cooldownScale;
        public double meleeArmorBonus;
        public double healthScale;
        public double moveSpeedScale;
        public double collisionHeightScale;
        public double radiusScale;
        public double acquireRange;
        public double authoredLength;
        public double baseReach;
        public int boosterCount;
        public double cargoHoverOffset;
        public double cargoSpinRate;
        public double carryDuration;
        public double clawBreakDamageMaxHealthScale;
        public int clawCount;
        public int clusterCount;
        public int comboCount;
        public double contactDamageScale;
        public double contactHitInterval;
        public double contactRadius;
        public bool continuousContactDamage;
        public double dragAccelerationScale;
        public double dragSpeedScale;
        public double extendedReach;
        public double extensionDistance;
        public double flipWindupDuration;
        public double guardDirectMultiplier;
        public double guardDuration;
        public double hopDistance;
        public double horizontalCommitDuration;
        public double horizontalSweepDamageScale;
        public double horizontalSweepRadius;
        public double impactRadius;
        public double landingDamageScale;
        public double landingRadius;
        public double liftDuration;
        public double locomotionJumpDistanceScale;
        public int maxCargo;
        public double minimumHopSeparation;
        public double mouthContactDamageScale;
        public double mouthContactHitInterval;
        public double mouthContactKnockback;
        public double mouthContactRadius;
        public double navigationJumpDuration;
        public double navigationJumpHeight;
        public double obstacleVaultHeight;
        public int palmBreakHitCount;
        public double playerCaptureRadius;
        public double playerImpactDamageScale;
        public double playerImpactRadius;
        public double playerThrowDistance;
        public double pounceJumpHeight;
        public double recoilDuration;
        public double shockwaveDamageScale;
        public double shockwaveRadius;
        public double slamCommitDuration;
        public double slamDamageScale;
        public double slamRadius;
        public double strikeProgress;
        public double throwArcHeight;
        public double throwDuration;
        public double throwLeadDistance;
        public double throwSpeed;
        public double trailDamageScale;
        public double trailDuration;
        public double vaultForwardDistance;
        public double vaultHeight;
        public double zigzagSpeedScale;
    }

    [Serializable]
    public sealed class ReaverbotChargeModuleRecord
    {
        public string id;
        public string label;
        public string mountRole;
        public int nozzleCount;
        public string[] tags;
    }

    [Serializable]
    public sealed class ReaverbotDefenseRecord
    {
        public string id;
        public string label;
        public string[] tags;
        public string[] requires;
        public string[] requiresAny;
        public double directMultiplier;
        public double flankMultiplier;
        public double uptime;
        public int threatCost;
    }

    [Serializable]
    public sealed class ReaverbotWeakPointRecord
    {
        public string id;
        public string label;
        public string location;
        public string exposure;
        public double multiplier;
        public bool lockable;
        public double radius;
    }

    [Serializable]
    public sealed class ReaverbotPaletteRecord
    {
        public string id;
        public uint primary;
        public uint secondary;
        public uint trim;
        public uint dark;
        public uint emissive;
    }

    [Serializable]
    public sealed class ReaverbotIntentWeightsRecord
    {
        public string intent;
        public ReaverbotArchetypeWeightRecord[] weights;
    }

    [Serializable]
    public sealed class ReaverbotArchetypeWeightRecord
    {
        public string archetypeId;
        public double weight;
    }

    [Serializable]
    public sealed class ReaverbotLinkedWeakPointWeightsRecord
    {
        // The exporter preserves this historical property name even though the
        // value is a defense module ID.
        public string weaponId;
        public ReaverbotWeakPointWeightRecord[] weights;
    }

    [Serializable]
    public sealed class ReaverbotWeakPointWeightRecord
    {
        public string weakPointId;
        public double weight;
    }

    [Serializable]
    public sealed class ReaverbotSalvageCatalogDto
    {
        public ReaverbotSalvageAspectRecord[] aspects;
        public ReaverbotSalvageMaterialRecord[] materials;
        public ReaverbotSalvageSourceMapRecord[] sourceMaps;
        public string[] bossOnlyMaterialIds;
    }

    [Serializable]
    public sealed class ReaverbotSalvageAspectRecord
    {
        public string id;
        public string label;
        public double baseDropChance;
    }

    [Serializable]
    public sealed class ReaverbotSalvageMaterialRecord
    {
        public string id;
        public string name;
        public string aspect;
        public string family;
        public string tier;
        public string color;
        public string[] craftingTags;
        public string[] exampleUses;
        public string description;
    }

    [Serializable]
    public sealed class ReaverbotSalvageSourceMapRecord
    {
        public string aspect;
        public ReaverbotSalvageSourceRecord[] sources;
    }

    [Serializable]
    public sealed class ReaverbotSalvageSourceRecord
    {
        public string moduleId;
        public string materialId;
    }
}
