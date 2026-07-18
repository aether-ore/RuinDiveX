using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Reaverbots
{
    public sealed class ReaverbotGenerationOptions
    {
        public string Seed { get; set; } = "reaverbot";
        public int ThreatTier { get; set; } = 1;
        public string Intent { get; set; } = "any";
        public string ArchetypeId { get; set; }
        public string BodyPlanId { get; set; }
        public string WeaponId { get; set; }
        public string DefenseId { get; set; }
        public string WeakPointId { get; set; }
        public string Biome { get; set; }
        public string RoomArchetypeId { get; set; }
        public string RoomFlavorId { get; set; }
        public IReadOnlyList<string> FavoredTags { get; set; } = Array.Empty<string>();
        public IReadOnlyList<string> BehaviorModifiers { get; set; } = Array.Empty<string>();
        public IReadOnlyList<string> SuppressedTags { get; set; } = Array.Empty<string>();
        public IReadOnlyList<string> ExcludedArchetypes { get; set; } = Array.Empty<string>();
        public int EncounterSize { get; set; } = 1;
        public bool Elite { get; set; }
        public bool IsBoss { get; set; }
        public bool KeycardCarrier { get; set; }
        public double HealthMultiplier { get; set; } = 1d;
        public int BossBudgetBonus { get; set; }
        public string BossProfileId { get; set; }
        public bool BossSafeOverload { get; set; }

        internal ReaverbotGenerationOptions Snapshot()
        {
            return new ReaverbotGenerationOptions
            {
                Seed = Seed ?? "reaverbot",
                ThreatTier = ThreatTier,
                Intent = Intent ?? "any",
                ArchetypeId = ArchetypeId,
                BodyPlanId = BodyPlanId,
                WeaponId = WeaponId,
                DefenseId = DefenseId,
                WeakPointId = WeakPointId,
                Biome = Biome,
                RoomArchetypeId = RoomArchetypeId,
                RoomFlavorId = RoomFlavorId,
                FavoredTags = ContractCollections.Freeze(FavoredTags),
                BehaviorModifiers = ContractCollections.Freeze(BehaviorModifiers),
                SuppressedTags = ContractCollections.Freeze(SuppressedTags),
                ExcludedArchetypes = ContractCollections.Freeze(ExcludedArchetypes),
                EncounterSize = EncounterSize,
                Elite = Elite,
                IsBoss = IsBoss,
                KeycardCarrier = KeycardCarrier,
                HealthMultiplier = HealthMultiplier,
                BossBudgetBonus = BossBudgetBonus,
                BossProfileId = BossProfileId,
                BossSafeOverload = BossSafeOverload,
            };
        }
    }

    public sealed class ReaverbotGenome
    {
        internal ReaverbotGenome(
            uint seed,
            string seedLabel,
            int candidateIndex,
            string name,
            int threatTier,
            ReaverbotThreat threat,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotBodyGenome body,
            ReaverbotModuleGenome modules,
            ReaverbotPaletteDefinition palette,
            ReaverbotBehaviorGenome behavior,
            ReaverbotStatsGenome stats,
            ReaverbotGenerationContext context,
            IReadOnlyList<string> tags)
        {
            SchemaVersion = ReaverbotCatalog.SupportedSchemaVersion;
            Seed = seed;
            SeedLabel = seedLabel;
            CandidateIndex = candidateIndex;
            // The source seed normally comes from a unique encounter slot, but
            // generation context is still part of identity. Including the
            // selected morphology prevents two valid forced/contextual builds
            // from aliasing when they deliberately reuse a seed.
            GenomeId = string.Join(
                ":",
                "reaverbot-v3",
                seed.ToString("X8", System.Globalization.CultureInfo.InvariantCulture),
                candidateIndex.ToString(System.Globalization.CultureInfo.InvariantCulture),
                threatTier.ToString(System.Globalization.CultureInfo.InvariantCulture),
                archetype.Id,
                body.PlanId,
                body.MobilityId,
                modules.Weapon.Id,
                modules.Defense?.Id ?? "none",
                modules.WeakPoint.Id);
            Name = name;
            ThreatTier = threatTier;
            Threat = threat;
            ArchetypeId = archetype.Id;
            ArchetypeLabel = archetype.Label;
            SquadRole = archetype.Role;
            Body = body;
            Modules = modules;
            PaletteId = archetype.PaletteId;
            Palette = palette;
            Behavior = behavior;
            Stats = stats;
            Context = context;
            Tags = ContractCollections.Freeze(tags);
        }

        public int SchemaVersion { get; }
        public uint Seed { get; }
        public string SeedLabel { get; }
        public int CandidateIndex { get; }
        public string GenomeId { get; }
        public string Name { get; }
        public int ThreatTier { get; }
        public ReaverbotThreat Threat { get; internal set; }
        public string ArchetypeId { get; }
        public string ArchetypeLabel { get; }
        public string SquadRole { get; }
        public ReaverbotBodyGenome Body { get; }
        public ReaverbotModuleGenome Modules { get; }
        public string PaletteId { get; }
        public ReaverbotPaletteDefinition Palette { get; }
        public ReaverbotBehaviorGenome Behavior { get; }
        public ReaverbotStatsGenome Stats { get; }
        public ReaverbotGenerationContext Context { get; }
        public IReadOnlyList<string> Tags { get; internal set; }
    }

    public sealed class ReaverbotThreat
    {
        public ReaverbotThreat(int budget, int spent)
        {
            Budget = budget;
            Spent = spent;
        }

        public int Budget { get; }
        public int Spent { get; }
    }

    public sealed class ReaverbotBodyGenome
    {
        internal ReaverbotBodyGenome(
            ReaverbotBodyPlanDefinition definition,
            string navigationMode,
            IReadOnlyList<string> tags,
            ReaverbotMobilityVariant mobility,
            ReaverbotProportions proportions)
        {
            Definition = definition;
            PlanId = definition.Id;
            Label = definition.Label;
            NavigationMode = navigationMode;
            HoverHeight = definition.HoverHeight;
            Tags = ContractCollections.Freeze(tags);
            MobilityId = mobility.Id;
            MobilityLabel = mobility.Label;
            MovementModel = mobility.MovementModel;
            MobilityLegCount = mobility.LegCount;
            MobilityWheelCount = mobility.WheelCount;
            MobilitySalvageId = mobility.SalvageModuleId;
            Proportions = proportions;
        }

        public ReaverbotBodyPlanDefinition Definition { get; }
        public string PlanId { get; }
        public string Label { get; }
        public string NavigationMode { get; }
        public double HoverHeight { get; }
        public IReadOnlyList<string> Tags { get; }
        public string MobilityId { get; }
        public string MobilityLabel { get; }
        public string MovementModel { get; }
        public int? MobilityLegCount { get; }
        public int MobilityWheelCount { get; }
        public string MobilitySalvageId { get; }
        public ReaverbotProportions Proportions { get; }
    }

    internal sealed class ReaverbotMobilityVariant
    {
        public ReaverbotMobilityVariant(
            string id,
            string label,
            string movementModel,
            int? legCount,
            int wheelCount,
            string salvageModuleId,
            double moveSpeedScale,
            double turnRateScale,
            IReadOnlyList<string> tags)
        {
            Id = id;
            Label = label;
            MovementModel = movementModel;
            LegCount = legCount;
            WheelCount = wheelCount;
            SalvageModuleId = salvageModuleId;
            MoveSpeedScale = moveSpeedScale;
            TurnRateScale = turnRateScale;
            Tags = ContractCollections.Freeze(tags);
        }

        public string Id { get; }
        public string Label { get; }
        public string MovementModel { get; }
        public int? LegCount { get; }
        public int WheelCount { get; }
        public string SalvageModuleId { get; }
        public double MoveSpeedScale { get; }
        public double TurnRateScale { get; }
        public IReadOnlyList<string> Tags { get; }
    }

    public sealed class ReaverbotProportions
    {
        internal ReaverbotProportions(
            double overallScale,
            double torsoWidth,
            double torsoLength,
            double limbLength,
            double headScale,
            int spikeCount,
            int panelRhythm,
            double asymmetry)
        {
            OverallScale = overallScale;
            TorsoWidth = torsoWidth;
            TorsoLength = torsoLength;
            LimbLength = limbLength;
            HeadScale = headScale;
            SpikeCount = spikeCount;
            PanelRhythm = panelRhythm;
            Asymmetry = asymmetry;
        }

        public double OverallScale { get; }
        public double TorsoWidth { get; }
        public double TorsoLength { get; }
        public double LimbLength { get; }
        public double HeadScale { get; }
        public int SpikeCount { get; }
        public int PanelRhythm { get; }
        public double Asymmetry { get; }
    }

    public sealed class ReaverbotModuleGenome
    {
        internal ReaverbotModuleGenome(
            ReaverbotEyeModule eye,
            ReaverbotWeaponModule weapon,
            ReaverbotChargeModule charge,
            ReaverbotDefenseModule defense,
            ReaverbotWeakPointModule weakPoint)
        {
            Eye = eye;
            Weapon = weapon;
            Charge = charge;
            Defense = defense;
            WeakPoint = weakPoint;
        }

        public ReaverbotEyeModule Eye { get; }
        public ReaverbotWeaponModule Weapon { get; }
        public ReaverbotChargeModule Charge { get; }
        public ReaverbotDefenseModule Defense { get; internal set; }
        public ReaverbotWeakPointModule WeakPoint { get; internal set; }
    }

    public sealed class ReaverbotEyeModule
    {
        internal ReaverbotEyeModule(uint color)
        {
            Id = "singleRubyLens";
            Color = color;
            Dominant = true;
        }

        public string Id { get; }
        public uint Color { get; }
        public bool Dominant { get; }
    }

    public sealed class ReaverbotWeaponModule
    {
        internal ReaverbotWeaponModule(
            ReaverbotWeaponDefinition definition,
            string attackKind = null,
            IReadOnlyList<string> tags = null,
            double? range = null,
            double? preferredRange = null,
            double? damageScale = null,
            string mountRole = null,
            bool integratedIntoMobility = false,
            int? mountSide = null,
            string jawVariant = null,
            bool bossSafe = false,
            IReadOnlyDictionary<string, double> numericOverrides = null)
        {
            Definition = definition;
            Id = definition.Id;
            Label = definition.Label;
            AttackKind = attackKind ?? definition.AttackKind;
            Tags = ContractCollections.Freeze(tags ?? definition.Tags);
            Range = range ?? definition.Range;
            PreferredRange = preferredRange ?? definition.PreferredRange;
            DamageScale = damageScale ?? definition.DamageScale;
            ThreatCost = definition.ThreatCost;
            MountRole = mountRole;
            IntegratedIntoMobility = integratedIntoMobility;
            MountSide = mountSide;
            JawVariant = jawVariant;
            BossSafe = bossSafe;

            var numbers = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, double> pair in definition.NumericPayload)
            {
                numbers.Add(pair.Key, pair.Value);
            }
            if (numericOverrides != null)
            {
                foreach (KeyValuePair<string, double> pair in numericOverrides)
                {
                    numbers[pair.Key] = pair.Value;
                }
            }

            NumericPayload = ContractCollections.Freeze(numbers);
        }

        public ReaverbotWeaponDefinition Definition { get; }
        public string Id { get; }
        public string Label { get; }
        public string AttackKind { get; }
        public IReadOnlyList<string> Tags { get; }
        public double Range { get; }
        public double? PreferredRange { get; }
        public double DamageScale { get; }
        public int ThreatCost { get; }
        public string MountRole { get; }
        public bool IntegratedIntoMobility { get; }
        public int? MountSide { get; }
        public string JawVariant { get; }
        public bool BossSafe { get; }
        public IReadOnlyDictionary<string, double> NumericPayload { get; }

        public bool HasTag(string tag) => ContractCollections.Contains(Tags, tag);
        public double? TelegraphDuration => Definition.TelegraphDuration;
        public double? CommitDuration => Definition.CommitDuration;
        public double? RecoveryDuration => Definition.RecoveryDuration;
        public double? CooldownScale => Definition.CooldownScale;
        public double? MeleeArmorBonus => Definition.MeleeArmorBonus;
        public double? HealthScale => Definition.HealthScale;
        public double? MoveSpeedScale => Definition.MoveSpeedScale;
        public double? CollisionHeightScale => Definition.CollisionHeightScale;
        public double? RadiusScale => Definition.RadiusScale;
    }

    public sealed class ReaverbotChargeModule
    {
        internal ReaverbotChargeModule(ReaverbotChargeModuleDefinition definition, double thrustScale)
        {
            Definition = definition;
            Id = definition.Id;
            Label = definition.Label;
            MountRole = definition.MountRole;
            NozzleCount = definition.NozzleCount;
            Tags = definition.Tags;
            ThrustScale = thrustScale;
        }

        public ReaverbotChargeModuleDefinition Definition { get; }
        public string Id { get; }
        public string Label { get; }
        public string MountRole { get; }
        public int NozzleCount { get; }
        public IReadOnlyList<string> Tags { get; }
        public double ThrustScale { get; }
    }

    public sealed class ReaverbotDefenseModule
    {
        internal ReaverbotDefenseModule(ReaverbotDefenseDefinition definition)
        {
            Definition = definition;
        }

        public ReaverbotDefenseDefinition Definition { get; }
        public string Id => Definition.Id;
        public string Label => Definition.Label;
        public IReadOnlyList<string> Tags => Definition.Tags;
        public double DirectMultiplier => Definition.DirectMultiplier;
        public double FlankMultiplier => Definition.FlankMultiplier;
        public double Uptime => Definition.Uptime;
        public int ThreatCost => Definition.ThreatCost;
    }

    public sealed class ReaverbotWeakPointModule
    {
        internal ReaverbotWeakPointModule(ReaverbotWeakPointDefinition definition)
        {
            Definition = definition;
        }

        public ReaverbotWeakPointDefinition Definition { get; }
        public string Id => Definition.Id;
        public string Label => Definition.Label;
        public string Location => Definition.Location;
        public string Exposure => Definition.Exposure;
        public double Multiplier => Definition.Multiplier;
        public bool Lockable => Definition.Lockable;
        public double Radius => Definition.Radius;
    }

    public sealed class ReaverbotBehaviorGenome
    {
        internal ReaverbotBehaviorGenome(
            ReaverbotArchetypeDefinition archetype,
            double preferredRange,
            double aggroRange,
            double telegraphDuration,
            double commitDuration,
            double recoveryDuration,
            double exposureDuration,
            double turnRate,
            int orbitDirection,
            double aggression)
        {
            Id = archetype.Id;
            Role = archetype.Role;
            PreferredRange = preferredRange;
            AggroRange = aggroRange;
            TelegraphDuration = telegraphDuration;
            CommitDuration = commitDuration;
            RecoveryDuration = recoveryDuration;
            ExposureDuration = exposureDuration;
            TurnRate = turnRate;
            OrbitDirection = orbitDirection;
            Aggression = aggression;
            MinimumPackSize = archetype.Behavior.MinimumPackSize;
            FlankApproachDistance = archetype.Behavior.FlankApproachDistance;
            FlankRearBiasMin = archetype.Behavior.FlankRearBiasMin;
            FlankRearBiasMax = archetype.Behavior.FlankRearBiasMax;
            FlankAttackDot = archetype.Behavior.FlankAttackDot;
            FlankPursuitSpeedScale = archetype.Behavior.FlankPursuitSpeedScale;
            AttackCooldownScale = archetype.Behavior.AttackCooldownScale;
            AttackCooldownFloor = archetype.Behavior.AttackCooldownFloor;
            ForcedAttackSeconds = archetype.Behavior.ForcedAttackSeconds;
        }

        public string Id { get; }
        public string Role { get; }
        public double PreferredRange { get; }
        public double AggroRange { get; }
        public double TelegraphDuration { get; }
        public double CommitDuration { get; }
        public double RecoveryDuration { get; }
        public double ExposureDuration { get; internal set; }
        public double TurnRate { get; }
        public int OrbitDirection { get; }
        public double Aggression { get; }
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

    public sealed class ReaverbotStatsGenome
    {
        internal ReaverbotStatsGenome(
            double maxHealth,
            double damage,
            double moveSpeed,
            double attackRange,
            double attackCooldown,
            double armor,
            int experience,
            double radius,
            double collisionHeight)
        {
            MaxHealth = maxHealth;
            Damage = damage;
            MoveSpeed = moveSpeed;
            AttackRange = attackRange;
            AttackCooldown = attackCooldown;
            Armor = armor;
            Experience = experience;
            Radius = radius;
            CollisionHeight = collisionHeight;
        }

        public double MaxHealth { get; }
        public double Damage { get; }
        public double MoveSpeed { get; }
        public double AttackRange { get; }
        public double AttackCooldown { get; }
        public double Armor { get; }
        public int Experience { get; }
        public double Radius { get; }
        public double CollisionHeight { get; }
    }

    public sealed class ReaverbotGenerationContext
    {
        internal ReaverbotGenerationContext(ReaverbotGenerationOptions options)
        {
            Intent = options.Intent ?? "any";
            RoomArchetypeId = options.RoomArchetypeId;
            RoomFlavorId = options.RoomFlavorId;
            EncounterSize = options.EncounterSize;
            Elite = options.Elite;
            IsBoss = options.IsBoss;
            KeycardCarrier = options.KeycardCarrier;
            BossProfileId = options.BossProfileId;
            BossSafeOverload = options.BossSafeOverload;
        }

        public string Intent { get; }
        public string RoomArchetypeId { get; }
        public string RoomFlavorId { get; }
        public int EncounterSize { get; }
        public bool Elite { get; }
        public bool IsBoss { get; }
        public bool KeycardCarrier { get; }
        public string BossProfileId { get; }
        public bool BossSafeOverload { get; }
    }

    public sealed class ReaverbotValidationResult
    {
        internal ReaverbotValidationResult(IEnumerable<string> errors, IEnumerable<string> warnings)
        {
            Errors = ContractCollections.Freeze(errors);
            Warnings = ContractCollections.Freeze(warnings);
        }

        public bool IsValid => Errors.Count == 0;
        public IReadOnlyList<string> Errors { get; }
        public IReadOnlyList<string> Warnings { get; }
    }

    public sealed class ReaverbotGenerationException : Exception
    {
        internal ReaverbotGenerationException(string message, ReaverbotValidationResult validation)
            : base(message)
        {
            Validation = validation;
        }

        public ReaverbotValidationResult Validation { get; }
    }
}
