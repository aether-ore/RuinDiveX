using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

namespace RuinCrawler.Core.Reaverbots
{
    public sealed class ReaverbotContractException : Exception
    {
        public ReaverbotContractException(IEnumerable<string> errors)
            : base("Invalid Reaverbot contract pack: " + string.Join(", ", errors ?? Array.Empty<string>()))
        {
            Errors = ContractCollections.Freeze(errors ?? Array.Empty<string>());
        }

        public IReadOnlyList<string> Errors { get; }
    }

    /// <summary>
    /// Immutable registry created from the array-based Unity contract pack.
    /// Dictionary indexes are derived here and are never part of serialized
    /// source data.
    /// </summary>
    public sealed class ReaverbotCatalog
    {
        public const int SupportedSchemaVersion = 3;

        private readonly IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> _archetypes;
        private readonly IReadOnlyDictionary<string, ReaverbotBodyPlanDefinition> _bodyPlans;
        private readonly IReadOnlyDictionary<string, ReaverbotWeaponDefinition> _weapons;
        private readonly IReadOnlyDictionary<string, ReaverbotChargeModuleDefinition> _chargeModules;
        private readonly IReadOnlyDictionary<string, ReaverbotDefenseDefinition> _defenses;
        private readonly IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> _weakPoints;
        private readonly IReadOnlyDictionary<string, ReaverbotPaletteDefinition> _palettes;
        private readonly IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> _intentWeights;
        private readonly IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> _linkedWeakPoints;

        private ReaverbotCatalog(
            int schemaVersion,
            uint eyeColor,
            IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> archetypes,
            IReadOnlyDictionary<string, ReaverbotBodyPlanDefinition> bodyPlans,
            IReadOnlyDictionary<string, ReaverbotWeaponDefinition> weapons,
            IReadOnlyDictionary<string, ReaverbotChargeModuleDefinition> chargeModules,
            IReadOnlyDictionary<string, ReaverbotDefenseDefinition> defenses,
            IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> weakPoints,
            IReadOnlyDictionary<string, ReaverbotPaletteDefinition> palettes,
            IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> intentWeights,
            IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> linkedWeakPoints,
            ReaverbotSalvageCatalog salvage)
        {
            SchemaVersion = schemaVersion;
            EyeColor = eyeColor;
            _archetypes = archetypes;
            _bodyPlans = bodyPlans;
            _weapons = weapons;
            _chargeModules = chargeModules;
            _defenses = defenses;
            _weakPoints = weakPoints;
            _palettes = palettes;
            _intentWeights = intentWeights;
            _linkedWeakPoints = linkedWeakPoints;
            Salvage = salvage;
        }

        public int SchemaVersion { get; }
        public uint EyeColor { get; }
        public IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> Archetypes => _archetypes;
        public IReadOnlyDictionary<string, ReaverbotBodyPlanDefinition> BodyPlans => _bodyPlans;
        public IReadOnlyDictionary<string, ReaverbotWeaponDefinition> Weapons => _weapons;
        public IReadOnlyDictionary<string, ReaverbotChargeModuleDefinition> ChargeModules => _chargeModules;
        public IReadOnlyDictionary<string, ReaverbotDefenseDefinition> Defenses => _defenses;
        public IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> WeakPoints => _weakPoints;
        public IReadOnlyDictionary<string, ReaverbotPaletteDefinition> Palettes => _palettes;
        public IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> IntentArchetypeWeights => _intentWeights;
        public IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> LinkedWeakPointWeights => _linkedWeakPoints;
        public ReaverbotSalvageCatalog Salvage { get; }

        public static ReaverbotCatalog Load(RuinCrawlerContractPackDto pack)
        {
            if (pack == null)
            {
                throw new ArgumentNullException(nameof(pack));
            }

            return Load(pack.reaverbots, pack.salvage);
        }

        public static ReaverbotCatalog Load(
            ReaverbotCatalogDto source,
            ReaverbotSalvageCatalogDto salvageSource)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            var errors = new List<string>();
            if (source.schemaVersion != SupportedSchemaVersion)
            {
                errors.Add("unsupported-schema-version");
            }

            if (source.eyeColor == 0u)
            {
                errors.Add("missing-eye-color");
            }

            Dictionary<string, ReaverbotArchetypeDefinition> archetypes = BuildIndex(
                source.archetypes,
                record => record?.id,
                record => record == null ? null : new ReaverbotArchetypeDefinition(record),
                "archetype",
                errors);
            Dictionary<string, ReaverbotBodyPlanDefinition> bodyPlans = BuildIndex(
                source.bodyPlans,
                record => record?.id,
                record => record == null ? null : new ReaverbotBodyPlanDefinition(record),
                "body-plan",
                errors);
            Dictionary<string, ReaverbotWeaponDefinition> weapons = BuildIndex(
                source.weapons,
                record => record?.id,
                record => record == null ? null : new ReaverbotWeaponDefinition(record),
                "weapon",
                errors);
            Dictionary<string, ReaverbotChargeModuleDefinition> chargeModules = BuildIndex(
                source.chargeModules,
                record => record?.id,
                record => record == null ? null : new ReaverbotChargeModuleDefinition(record),
                "charge-module",
                errors);
            Dictionary<string, ReaverbotDefenseDefinition> defenses = BuildIndex(
                source.defenses,
                record => record?.id,
                record => record == null ? null : new ReaverbotDefenseDefinition(record),
                "defense",
                errors);
            Dictionary<string, ReaverbotWeakPointDefinition> weakPoints = BuildIndex(
                source.weakPoints,
                record => record?.id,
                record => record == null ? null : new ReaverbotWeakPointDefinition(record),
                "weak-point",
                errors);
            Dictionary<string, ReaverbotPaletteDefinition> palettes = BuildIndex(
                source.palettes,
                record => record?.id,
                record => record == null ? null : new ReaverbotPaletteDefinition(record),
                "palette",
                errors);

            ValidateArchetypeReferences(archetypes, bodyPlans, weapons, defenses, weakPoints, palettes, errors);
            Dictionary<string, IReadOnlyList<ReaverbotWeightedId>> intentWeights = BuildIntentWeights(
                source.intentArchetypeWeights,
                archetypes,
                errors);
            Dictionary<string, IReadOnlyList<ReaverbotWeightedId>> linkedWeakPoints = BuildLinkedWeakPoints(
                source.linkedWeakPointWeights,
                defenses,
                weakPoints,
                errors);

            var salvage = ReaverbotSalvageCatalog.Load(salvageSource, errors);
            ValidateSalvageCompleteness(
                archetypes,
                bodyPlans,
                weapons,
                chargeModules,
                defenses,
                weakPoints,
                salvage,
                errors);

            if (!intentWeights.ContainsKey("any"))
            {
                errors.Add("missing-intent-any");
            }

            if (errors.Count > 0)
            {
                throw new ReaverbotContractException(errors);
            }

            return new ReaverbotCatalog(
                source.schemaVersion,
                source.eyeColor,
                ContractCollections.Freeze(archetypes),
                ContractCollections.Freeze(bodyPlans),
                ContractCollections.Freeze(weapons),
                ContractCollections.Freeze(chargeModules),
                ContractCollections.Freeze(defenses),
                ContractCollections.Freeze(weakPoints),
                ContractCollections.Freeze(palettes),
                ContractCollections.Freeze(intentWeights),
                ContractCollections.Freeze(linkedWeakPoints),
                salvage);
        }

        private static Dictionary<string, TDefinition> BuildIndex<TRecord, TDefinition>(
            TRecord[] records,
            Func<TRecord, string> idFor,
            Func<TRecord, TDefinition> create,
            string kind,
            ICollection<string> errors)
            where TDefinition : class
        {
            var result = new Dictionary<string, TDefinition>(StringComparer.Ordinal);
            if (records == null)
            {
                errors.Add("missing-" + kind + "-catalog");
                return result;
            }

            for (int index = 0; index < records.Length; index += 1)
            {
                TRecord record = records[index];
                string id = idFor(record);
                if (string.IsNullOrWhiteSpace(id))
                {
                    errors.Add("missing-" + kind + "-id");
                    continue;
                }

                if (result.ContainsKey(id))
                {
                    errors.Add("duplicate-" + kind + ":" + id);
                    continue;
                }

                TDefinition definition = create(record);
                if (definition == null)
                {
                    errors.Add("invalid-" + kind + ":" + id);
                    continue;
                }

                result.Add(id, definition);
            }

            return result;
        }

        private static void ValidateArchetypeReferences(
            IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> archetypes,
            IReadOnlyDictionary<string, ReaverbotBodyPlanDefinition> bodyPlans,
            IReadOnlyDictionary<string, ReaverbotWeaponDefinition> weapons,
            IReadOnlyDictionary<string, ReaverbotDefenseDefinition> defenses,
            IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> weakPoints,
            IReadOnlyDictionary<string, ReaverbotPaletteDefinition> palettes,
            ICollection<string> errors)
        {
            foreach (ReaverbotArchetypeDefinition archetype in archetypes.Values)
            {
                RequireReferences(archetype.BodyPlanIds, bodyPlans, "unknown-body-plan", archetype.Id, errors);
                RequireReferences(archetype.WeaponIds, weapons, "unknown-weapon", archetype.Id, errors);
                RequireReferences(archetype.DefenseIds, defenses, "unknown-defense", archetype.Id, errors);
                RequireReferences(archetype.WeakPointIds, weakPoints, "unknown-weak-point", archetype.Id, errors);
                if (!palettes.ContainsKey(archetype.PaletteId))
                {
                    errors.Add("unknown-palette:" + archetype.Id + ":" + archetype.PaletteId);
                }
            }
        }

        private static void RequireReferences<T>(
            IReadOnlyList<string> ids,
            IReadOnlyDictionary<string, T> registry,
            string error,
            string ownerId,
            ICollection<string> errors)
        {
            foreach (string id in ids)
            {
                if (!registry.ContainsKey(id))
                {
                    errors.Add(error + ":" + ownerId + ":" + id);
                }
            }
        }

        private static Dictionary<string, IReadOnlyList<ReaverbotWeightedId>> BuildIntentWeights(
            ReaverbotIntentWeightsRecord[] records,
            IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> archetypes,
            ICollection<string> errors)
        {
            var result = new Dictionary<string, IReadOnlyList<ReaverbotWeightedId>>(StringComparer.Ordinal);
            if (records == null)
            {
                errors.Add("missing-intent-weight-catalog");
                return result;
            }

            foreach (ReaverbotIntentWeightsRecord record in records)
            {
                if (record == null || string.IsNullOrWhiteSpace(record.intent))
                {
                    errors.Add("missing-intent-id");
                    continue;
                }

                if (result.ContainsKey(record.intent))
                {
                    errors.Add("duplicate-intent:" + record.intent);
                    continue;
                }

                var weights = new List<ReaverbotWeightedId>();
                foreach (ReaverbotArchetypeWeightRecord weight in record.weights ?? Array.Empty<ReaverbotArchetypeWeightRecord>())
                {
                    if (weight == null || !archetypes.ContainsKey(weight.archetypeId ?? string.Empty))
                    {
                        errors.Add("unknown-intent-archetype:" + record.intent + ":" + (weight?.archetypeId ?? string.Empty));
                        continue;
                    }

                    if (!IsFinitePositive(weight.weight))
                    {
                        errors.Add("invalid-intent-weight:" + record.intent + ":" + weight.archetypeId);
                        continue;
                    }

                    weights.Add(new ReaverbotWeightedId(weight.archetypeId, weight.weight));
                }

                result.Add(record.intent, ContractCollections.Freeze(weights));
            }

            return result;
        }

        private static Dictionary<string, IReadOnlyList<ReaverbotWeightedId>> BuildLinkedWeakPoints(
            ReaverbotLinkedWeakPointWeightsRecord[] records,
            IReadOnlyDictionary<string, ReaverbotDefenseDefinition> defenses,
            IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> weakPoints,
            ICollection<string> errors)
        {
            var result = new Dictionary<string, IReadOnlyList<ReaverbotWeightedId>>(StringComparer.Ordinal);
            if (records == null)
            {
                errors.Add("missing-linked-weak-point-catalog");
                return result;
            }

            foreach (ReaverbotLinkedWeakPointWeightsRecord record in records)
            {
                string defenseId = record?.weaponId;
                if (string.IsNullOrWhiteSpace(defenseId) || !defenses.ContainsKey(defenseId))
                {
                    errors.Add("unknown-linked-defense:" + (defenseId ?? string.Empty));
                    continue;
                }

                if (result.ContainsKey(defenseId))
                {
                    errors.Add("duplicate-linked-defense:" + defenseId);
                    continue;
                }

                var weights = new List<ReaverbotWeightedId>();
                foreach (ReaverbotWeakPointWeightRecord weight in record.weights ?? Array.Empty<ReaverbotWeakPointWeightRecord>())
                {
                    if (weight == null || !weakPoints.ContainsKey(weight.weakPointId ?? string.Empty))
                    {
                        errors.Add("unknown-linked-weak-point:" + defenseId + ":" + (weight?.weakPointId ?? string.Empty));
                        continue;
                    }

                    if (!IsFinitePositive(weight.weight))
                    {
                        errors.Add("invalid-linked-weight:" + defenseId + ":" + weight.weakPointId);
                        continue;
                    }

                    weights.Add(new ReaverbotWeightedId(weight.weakPointId, weight.weight));
                }

                result.Add(defenseId, ContractCollections.Freeze(weights));
            }

            return result;
        }

        private static void ValidateSalvageCompleteness(
            IReadOnlyDictionary<string, ReaverbotArchetypeDefinition> archetypes,
            IReadOnlyDictionary<string, ReaverbotBodyPlanDefinition> bodyPlans,
            IReadOnlyDictionary<string, ReaverbotWeaponDefinition> weapons,
            IReadOnlyDictionary<string, ReaverbotChargeModuleDefinition> chargeModules,
            IReadOnlyDictionary<string, ReaverbotDefenseDefinition> defenses,
            IReadOnlyDictionary<string, ReaverbotWeakPointDefinition> weakPoints,
            ReaverbotSalvageCatalog salvage,
            ICollection<string> errors)
        {
            if (salvage == null)
            {
                errors.Add("missing-salvage-catalog");
                return;
            }

            RequireSalvageSources("behavior", archetypes.Keys, salvage, errors);
            RequireSalvageSources("body", bodyPlans.Keys.Concat(new[] { "articulatedCrawler", "wheelBogies" }), salvage, errors);
            RequireSalvageSources("eye", new[] { "singleRubyLens" }, salvage, errors);
            RequireSalvageSources("weapon", weapons.Keys, salvage, errors);
            RequireSalvageSources("charge", chargeModules.Keys, salvage, errors);
            RequireSalvageSources("defense", defenses.Keys, salvage, errors);
            RequireSalvageSources("weakPoint", weakPoints.Keys, salvage, errors);
        }

        private static void RequireSalvageSources(
            string aspect,
            IEnumerable<string> ids,
            ReaverbotSalvageCatalog salvage,
            ICollection<string> errors)
        {
            foreach (string id in ids)
            {
                if (!salvage.TryGetMaterial(aspect, id, out _))
                {
                    errors.Add("missing-salvage-source:" + aspect + ":" + id);
                }
            }
        }

        private static bool IsFinitePositive(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value) && value > 0d;
        }
    }

    public sealed class ReaverbotWeightedId
    {
        public ReaverbotWeightedId(string id, double weight)
        {
            Id = id;
            Weight = weight;
        }

        public string Id { get; }
        public double Weight { get; }
    }

    public sealed class ReaverbotArchetypeDefinition
    {
        internal ReaverbotArchetypeDefinition(ReaverbotArchetypeRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            Role = source.role ?? string.Empty;
            BodyPlanIds = ContractCollections.Freeze(source.bodyPlans);
            WeaponIds = ContractCollections.Freeze(source.weapons);
            DefenseIds = ContractCollections.Freeze(source.defenses);
            WeakPointIds = ContractCollections.Freeze(source.weakPoints);
            PaletteId = source.paletteId ?? string.Empty;
            BaseStats = new ReaverbotBaseStats(source.baseStats);
            Behavior = new ReaverbotArchetypeBehavior(source.behavior);
            ThreatCost = source.threatCost;
        }

        public string Id { get; }
        public string Label { get; }
        public string Role { get; }
        public IReadOnlyList<string> BodyPlanIds { get; }
        public IReadOnlyList<string> WeaponIds { get; }
        public IReadOnlyList<string> DefenseIds { get; }
        public IReadOnlyList<string> WeakPointIds { get; }
        public string PaletteId { get; }
        public ReaverbotBaseStats BaseStats { get; }
        public ReaverbotArchetypeBehavior Behavior { get; }
        public int ThreatCost { get; }
    }

    public sealed class ReaverbotBaseStats
    {
        internal ReaverbotBaseStats(ReaverbotBaseStatsRecord source)
        {
            source = source ?? new ReaverbotBaseStatsRecord();
            Health = source.health;
            Damage = source.damage;
            Speed = source.speed;
            Armor = source.armor;
            Radius = source.radius;
        }

        public double Health { get; }
        public double Damage { get; }
        public double Speed { get; }
        public double Armor { get; }
        public double Radius { get; }
    }

    public sealed class ReaverbotArchetypeBehavior
    {
        internal ReaverbotArchetypeBehavior(ReaverbotArchetypeBehaviorRecord source)
        {
            source = source ?? new ReaverbotArchetypeBehaviorRecord();
            PreferredRange = source.preferredRange;
            AggroRange = source.aggroRange;
            Telegraph = source.telegraph;
            Commit = source.commit;
            Recovery = source.recovery;
            TurnRate = source.turnRate;
            MinimumPackSize = source.minimumPackSize == 0 ? 1 : source.minimumPackSize;
            FlankApproachDistance = source.flankApproachDistance;
            FlankRearBiasMin = source.flankRearBiasMin;
            FlankRearBiasMax = source.flankRearBiasMax;
            FlankAttackDot = source.flankAttackDot;
            FlankPursuitSpeedScale = source.flankPursuitSpeedScale;
            AttackCooldownScale = source.attackCooldownScale;
            AttackCooldownFloor = source.attackCooldownFloor;
            ForcedAttackSeconds = source.forcedAttackSeconds;
        }

        public double PreferredRange { get; }
        public double AggroRange { get; }
        public double Telegraph { get; }
        public double Commit { get; }
        public double Recovery { get; }
        public double TurnRate { get; }
        public int MinimumPackSize { get; }
        public double FlankApproachDistance { get; }
        public double FlankRearBiasMin { get; }
        public double FlankRearBiasMax { get; }
        public double FlankAttackDot { get; }
        public double FlankPursuitSpeedScale { get; }
        public double AttackCooldownScale { get; }
        public double AttackCooldownFloor { get; }
        public double ForcedAttackSeconds { get; }
    }

    public sealed class ReaverbotBodyPlanDefinition
    {
        internal ReaverbotBodyPlanDefinition(ReaverbotBodyPlanRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            Tags = ContractCollections.Freeze(source.tags);
            Height = source.height;
            RadiusScale = source.radiusScale;
            HoverHeight = source.hoverHeight;
        }

        public string Id { get; }
        public string Label { get; }
        public IReadOnlyList<string> Tags { get; }
        public double Height { get; }
        public double RadiusScale { get; }
        public double HoverHeight { get; }

        public bool HasTag(string tag) => ContractCollections.Contains(Tags, tag);
    }

    public sealed class ReaverbotWeaponDefinition
    {
        private readonly IReadOnlyDictionary<string, double> _numericPayload;

        internal ReaverbotWeaponDefinition(ReaverbotWeaponRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            Tags = ContractCollections.Freeze(source.tags);
            Requires = ContractCollections.Freeze(source.requires);
            RequiresAny = ContractCollections.Freeze(source.requiresAny);
            BodyPlanIds = ContractCollections.Freeze(source.bodyPlans);
            AttackKind = source.attackKind ?? string.Empty;
            Range = source.range;
            DamageScale = source.damageScale;
            ThreatCost = (int)source.threatCost;
            PreferredRange = Optional(source.preferredRange);
            ProjectileSpeed = Optional(source.projectileSpeed);
            ExplosiveRadius = Optional(source.explosiveRadius);
            TelegraphDuration = Optional(source.telegraphDuration);
            CommitDuration = Optional(source.commitDuration);
            RecoveryDuration = Optional(source.recoveryDuration);
            CooldownScale = Optional(source.cooldownScale);
            MeleeArmorBonus = Optional(source.meleeArmorBonus);
            HealthScale = Optional(source.healthScale);
            MoveSpeedScale = Optional(source.moveSpeedScale);
            CollisionHeightScale = Optional(source.collisionHeightScale);
            RadiusScale = Optional(source.radiusScale);
            _numericPayload = ContractCollections.Freeze(BuildNumericPayload(source));
        }

        public string Id { get; }
        public string Label { get; }
        public IReadOnlyList<string> Tags { get; }
        public IReadOnlyList<string> Requires { get; }
        public IReadOnlyList<string> RequiresAny { get; }
        public IReadOnlyList<string> BodyPlanIds { get; }
        public string AttackKind { get; }
        public double Range { get; }
        public double DamageScale { get; }
        public int ThreatCost { get; }
        public double? PreferredRange { get; }
        public double? ProjectileSpeed { get; }
        public double? ExplosiveRadius { get; }
        public double? TelegraphDuration { get; }
        public double? CommitDuration { get; }
        public double? RecoveryDuration { get; }
        public double? CooldownScale { get; }
        public double? MeleeArmorBonus { get; }
        public double? HealthScale { get; }
        public double? MoveSpeedScale { get; }
        public double? CollisionHeightScale { get; }
        public double? RadiusScale { get; }
        public IReadOnlyDictionary<string, double> NumericPayload => _numericPayload;

        public bool HasTag(string tag) => ContractCollections.Contains(Tags, tag);

        private static double? Optional(double value) => value == 0d ? (double?)null : value;

        private static Dictionary<string, double> BuildNumericPayload(ReaverbotWeaponRecord source)
        {
            // Retain every exported attack-specific number for runtime adapters
            // without making generation depend on presentation-only fields.
            return new Dictionary<string, double>(StringComparer.Ordinal)
            {
                ["acquireRange"] = source.acquireRange,
                ["authoredLength"] = source.authoredLength,
                ["baseReach"] = source.baseReach,
                ["boosterCount"] = source.boosterCount,
                ["cargoHoverOffset"] = source.cargoHoverOffset,
                ["cargoSpinRate"] = source.cargoSpinRate,
                ["carryDuration"] = source.carryDuration,
                ["clawBreakDamageMaxHealthScale"] = source.clawBreakDamageMaxHealthScale,
                ["clawCount"] = source.clawCount,
                ["clusterCount"] = source.clusterCount,
                ["comboCount"] = source.comboCount,
                ["contactDamageScale"] = source.contactDamageScale,
                ["contactHitInterval"] = source.contactHitInterval,
                ["contactRadius"] = source.contactRadius,
                ["continuousContactDamage"] = source.continuousContactDamage ? 1d : 0d,
                ["dragAccelerationScale"] = source.dragAccelerationScale,
                ["dragSpeedScale"] = source.dragSpeedScale,
                ["extendedReach"] = source.extendedReach,
                ["extensionDistance"] = source.extensionDistance,
                ["flipWindupDuration"] = source.flipWindupDuration,
                ["guardDirectMultiplier"] = source.guardDirectMultiplier,
                ["guardDuration"] = source.guardDuration,
                ["hopDistance"] = source.hopDistance,
                ["horizontalCommitDuration"] = source.horizontalCommitDuration,
                ["horizontalSweepDamageScale"] = source.horizontalSweepDamageScale,
                ["horizontalSweepRadius"] = source.horizontalSweepRadius,
                ["impactRadius"] = source.impactRadius,
                ["landingDamageScale"] = source.landingDamageScale,
                ["landingRadius"] = source.landingRadius,
                ["liftDuration"] = source.liftDuration,
                ["locomotionJumpDistanceScale"] = source.locomotionJumpDistanceScale,
                ["maxCargo"] = source.maxCargo,
                ["minimumHopSeparation"] = source.minimumHopSeparation,
                ["mouthContactDamageScale"] = source.mouthContactDamageScale,
                ["mouthContactHitInterval"] = source.mouthContactHitInterval,
                ["mouthContactKnockback"] = source.mouthContactKnockback,
                ["mouthContactRadius"] = source.mouthContactRadius,
                ["navigationJumpDuration"] = source.navigationJumpDuration,
                ["navigationJumpHeight"] = source.navigationJumpHeight,
                ["obstacleVaultHeight"] = source.obstacleVaultHeight,
                ["palmBreakHitCount"] = source.palmBreakHitCount,
                ["playerCaptureRadius"] = source.playerCaptureRadius,
                ["playerImpactDamageScale"] = source.playerImpactDamageScale,
                ["playerImpactRadius"] = source.playerImpactRadius,
                ["playerThrowDistance"] = source.playerThrowDistance,
                ["pounceJumpHeight"] = source.pounceJumpHeight,
                ["recoilDuration"] = source.recoilDuration,
                ["shockwaveDamageScale"] = source.shockwaveDamageScale,
                ["shockwaveRadius"] = source.shockwaveRadius,
                ["slamCommitDuration"] = source.slamCommitDuration,
                ["slamDamageScale"] = source.slamDamageScale,
                ["slamRadius"] = source.slamRadius,
                ["strikeProgress"] = source.strikeProgress,
                ["throwArcHeight"] = source.throwArcHeight,
                ["throwDuration"] = source.throwDuration,
                ["throwLeadDistance"] = source.throwLeadDistance,
                ["throwSpeed"] = source.throwSpeed,
                ["trailDamageScale"] = source.trailDamageScale,
                ["trailDuration"] = source.trailDuration,
                ["vaultForwardDistance"] = source.vaultForwardDistance,
                ["vaultHeight"] = source.vaultHeight,
                ["zigzagSpeedScale"] = source.zigzagSpeedScale,
            };
        }
    }

    public sealed class ReaverbotChargeModuleDefinition
    {
        internal ReaverbotChargeModuleDefinition(ReaverbotChargeModuleRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            MountRole = source.mountRole ?? string.Empty;
            NozzleCount = source.nozzleCount;
            Tags = ContractCollections.Freeze(source.tags);
        }

        public string Id { get; }
        public string Label { get; }
        public string MountRole { get; }
        public int NozzleCount { get; }
        public IReadOnlyList<string> Tags { get; }
    }

    public sealed class ReaverbotDefenseDefinition
    {
        internal ReaverbotDefenseDefinition(ReaverbotDefenseRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            Tags = ContractCollections.Freeze(source.tags);
            Requires = ContractCollections.Freeze(source.requires);
            RequiresAny = ContractCollections.Freeze(source.requiresAny);
            DirectMultiplier = source.directMultiplier;
            FlankMultiplier = source.flankMultiplier;
            Uptime = source.uptime;
            ThreatCost = source.threatCost;
        }

        public string Id { get; }
        public string Label { get; }
        public IReadOnlyList<string> Tags { get; }
        public IReadOnlyList<string> Requires { get; }
        public IReadOnlyList<string> RequiresAny { get; }
        public double DirectMultiplier { get; }
        public double FlankMultiplier { get; }
        public double Uptime { get; }
        public int ThreatCost { get; }
    }

    public sealed class ReaverbotWeakPointDefinition
    {
        internal ReaverbotWeakPointDefinition(ReaverbotWeakPointRecord source)
        {
            Id = source.id;
            Label = source.label ?? source.id;
            Location = source.location ?? string.Empty;
            Exposure = source.exposure ?? string.Empty;
            Multiplier = source.multiplier;
            Lockable = source.lockable;
            Radius = source.radius;
        }

        public string Id { get; }
        public string Label { get; }
        public string Location { get; }
        public string Exposure { get; }
        public double Multiplier { get; }
        public bool Lockable { get; }
        public double Radius { get; }
    }

    public sealed class ReaverbotPaletteDefinition
    {
        internal ReaverbotPaletteDefinition(ReaverbotPaletteRecord source)
        {
            Id = source.id;
            Primary = source.primary;
            Secondary = source.secondary;
            Trim = source.trim;
            Dark = source.dark;
            Emissive = source.emissive;
        }

        public string Id { get; }
        public uint Primary { get; }
        public uint Secondary { get; }
        public uint Trim { get; }
        public uint Dark { get; }
        public uint Emissive { get; }
    }

    internal static class ContractCollections
    {
        public static IReadOnlyList<T> Freeze<T>(IEnumerable<T> source)
        {
            return new ReadOnlyCollection<T>((source ?? Array.Empty<T>()).ToArray());
        }

        public static IReadOnlyDictionary<TKey, TValue> Freeze<TKey, TValue>(
            IDictionary<TKey, TValue> source)
        {
            return new ReadOnlyDictionary<TKey, TValue>(
                new Dictionary<TKey, TValue>(source));
        }

        public static bool Contains(IReadOnlyList<string> values, string value)
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
    }
}
