using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster
{
    public sealed class BusterCompileException : Exception
    {
        public BusterCompileException(IReadOnlyList<BusterValidationIssue> errors)
            : base($"Custom Buster compilation failed with {errors?.Count ?? 0} validation error(s).")
        {
            Code = "BUSTER_COMPILE_FAILED";
            Errors = errors ?? Array.Empty<BusterValidationIssue>();
        }

        public string Code { get; }
        public IReadOnlyList<BusterValidationIssue> Errors { get; }
    }

    public sealed class BusterEmitterConfiguration
    {
        internal BusterEmitterConfiguration(BusterModuleDefinition definition)
        {
            ModuleId = definition.Id;
            Speed = definition.ProjectileSpeed;
            Trajectory = definition.Trajectory;
            NativePayload = definition.NativePayload;
            BasePower = definition.BasePower;
            BaseRange = definition.BaseRange;
            BaseRapid = definition.BaseRapid;
        }

        public string ModuleId { get; }
        public double Speed { get; }
        public string Trajectory { get; }
        public string NativePayload { get; }
        public double BasePower { get; }
        public double BaseRange { get; }
        public double BaseRapid { get; }
    }

    public sealed class BusterTriggerConfiguration
    {
        internal BusterTriggerConfiguration(BusterModuleDefinition definition)
        {
            ModuleId = definition.Id;
            Event = definition.TriggerEvent;
            Delay = definition.Delay;
            CarrierAllocation = definition.CarrierAllocation;
            ChildTransfer = definition.ChildTransfer;
            DisposeCarrier = true;
            CarrierTerminationBehavior = Event == "delay" || Event == "apex"
                ? "deliver-child"
                : "trigger-child";
        }

        public string ModuleId { get; }
        public string Event { get; }
        public double Delay { get; }
        public double CarrierAllocation { get; }
        public double ChildTransfer { get; }
        public bool DisposeCarrier { get; }
        public string CarrierTerminationBehavior { get; }
    }

    public sealed class BusterSplitterConfiguration
    {
        internal BusterSplitterConfiguration(BusterModuleDefinition definition)
        {
            ModuleId = definition.Id;
            Count = definition.ProjectileCount;
            Pattern = definition.Pattern;
            AngleOffsets = Array.AsReadOnly(new List<double>(definition.AngleOffsets).ToArray());
            RadialCount = definition.RadialCount;
            TotalPowerMultiplier = definition.TotalPowerMultiplier;
        }

        public string ModuleId { get; }
        public int Count { get; }
        public string Pattern { get; }
        public IReadOnlyList<double> AngleOffsets { get; }
        public int? RadialCount { get; }
        public double TotalPowerMultiplier { get; }
    }

    public sealed class BusterPayloadConfiguration
    {
        internal BusterPayloadConfiguration(
            string moduleId,
            string type,
            double radius,
            bool replacesDirect,
            bool isImplicit)
        {
            ModuleId = moduleId;
            Type = type;
            Radius = radius;
            ReplacesDirect = replacesDirect;
            IsImplicit = isImplicit;
        }

        public string ModuleId { get; }
        public string Type { get; }
        public double Radius { get; }
        public bool ReplacesDirect { get; }
        public bool IsImplicit { get; }
    }

    public sealed class BusterPacket
    {
        internal BusterPacket(
            int count,
            double power,
            double totalPower,
            double damagePower,
            double range,
            double speed,
            double stagger)
        {
            Count = count;
            Power = power;
            TotalPower = totalPower;
            DamagePower = damagePower;
            Range = range;
            Speed = speed;
            Stagger = stagger;
        }

        public int Count { get; }
        public double Power { get; }
        public double TotalPower { get; }
        public double DamagePower { get; }
        public double Range { get; }
        public double Speed { get; }
        public double Stagger { get; }
    }

    public sealed class BusterPowerSoftCap
    {
        internal BusterPowerSoftCap(
            bool active,
            double rawMultiplier,
            double effectiveMultiplier,
            double compression)
        {
            Active = active;
            Knee = BusterRuleset.PowerSoftCapKnee;
            Asymptote = BusterRuleset.PowerSoftCapAsymptote;
            Steepness = BusterRuleset.PowerSoftCapSteepness;
            RawMultiplier = rawMultiplier;
            EffectiveMultiplier = effectiveMultiplier;
            Compression = compression;
        }

        public bool Active { get; }
        public double Knee { get; }
        public double Asymptote { get; }
        public double Steepness { get; }
        public double RawMultiplier { get; }
        public double EffectiveMultiplier { get; }
        public double Compression { get; }
    }

    public sealed class BusterOccupancy
    {
        internal BusterOccupancy(
            int peakMovingProjectiles,
            double nominalRootLifetime,
            double nominalChildLifetime,
            double nominalCarrierProjectileSeconds,
            double projectileSecondsPerExecution,
            double estimatedSteadyMovingProjectiles)
        {
            PeakMovingProjectiles = peakMovingProjectiles;
            NominalRootLifetime = nominalRootLifetime;
            NominalChildLifetime = nominalChildLifetime;
            NominalCarrierProjectileSeconds = nominalCarrierProjectileSeconds;
            ProjectileSecondsPerExecution = projectileSecondsPerExecution;
            EstimatedSteadyMovingProjectiles = estimatedSteadyMovingProjectiles;
        }

        public int PeakMovingProjectiles { get; }
        public double NominalRootLifetime { get; }
        public double NominalChildLifetime { get; }
        public double NominalCarrierProjectileSeconds { get; }
        public double ProjectileSecondsPerExecution { get; }
        public double EstimatedSteadyMovingProjectiles { get; }
    }

    public sealed class BusterTrajectory
    {
        internal BusterTrajectory(
            string type,
            double speed,
            double rootRange,
            double childRange,
            double nominalRootLifetime,
            double nominalChildLifetime,
            string triggerEvent,
            double? triggerNominalTime,
            double? triggerNominalProgress)
        {
            Type = type;
            Speed = speed;
            RootRange = rootRange;
            ChildRange = childRange;
            NominalRootLifetime = nominalRootLifetime;
            NominalChildLifetime = nominalChildLifetime;
            TriggerEvent = triggerEvent;
            TriggerNominalTime = triggerNominalTime;
            TriggerNominalProgress = triggerNominalProgress;
        }

        public string Type { get; }
        public double Speed { get; }
        public double RootRange { get; }
        public double ChildRange { get; }
        public double NominalRootLifetime { get; }
        public double NominalChildLifetime { get; }
        public string TriggerEvent { get; }
        public double? TriggerNominalTime { get; }
        public double? TriggerNominalProgress { get; }
    }

    public sealed class BusterStats
    {
        internal BusterStats(
            double basePower,
            double tunedPower,
            double depthScaledPower,
            int combatDepthLevel,
            double combatDepthScalar,
            double effectivePower,
            double rawEffectivePower,
            double perChildPower,
            double carrierPower,
            double maxEnergy,
            double energyCost,
            double cycleTime,
            double finalRapid,
            double rootRange,
            double childRange,
            double projectileSpeed,
            int projectileCount,
            int shotsPerCharge,
            double stagger,
            double carrierStagger,
            int peakProjectileReservation,
            int programCapacityUsed,
            BusterPowerSoftCap powerSoftCap,
            BusterOccupancy occupancy)
        {
            BasePower = basePower;
            TunedPower = tunedPower;
            DepthScaledPower = depthScaledPower;
            CombatDepthLevel = combatDepthLevel;
            CombatDepthScalar = combatDepthScalar;
            EffectivePower = effectivePower;
            RawEffectivePower = rawEffectivePower;
            PerChildPower = perChildPower;
            CarrierPower = carrierPower;
            MaxEnergy = maxEnergy;
            EnergyCost = energyCost;
            EnergyRemaining = maxEnergy - energyCost;
            CycleTime = cycleTime;
            FinalRapid = finalRapid;
            RootRange = rootRange;
            ChildRange = childRange;
            ProjectileSpeed = projectileSpeed;
            ProjectileCount = projectileCount;
            ShotsPerCharge = shotsPerCharge;
            Stagger = stagger;
            CarrierStagger = carrierStagger;
            PeakProjectileReservation = peakProjectileReservation;
            ProgramCapacityUsed = programCapacityUsed;
            ProgramCapacityMaximum = BusterRuleset.ChassisCapacity;
            PowerSoftCap = powerSoftCap;
            Occupancy = occupancy;
        }

        public double BasePower { get; }
        public double TunedPower { get; }
        public double DepthScaledPower { get; }
        public int CombatDepthLevel { get; }
        public double CombatDepthScalar { get; }
        public double EffectivePower { get; }
        public double RawEffectivePower { get; }
        public double PerChildPower { get; }
        public double CarrierPower { get; }
        public double MaxEnergy { get; }
        public double EnergyCost { get; }
        public double EnergyRemaining { get; }
        public double CycleTime { get; }
        public double FinalRapid { get; }
        public double RootRange { get; }
        public double ChildRange { get; }
        public double ProjectileSpeed { get; }
        public int ProjectileCount { get; }
        public int ShotsPerCharge { get; }
        public double Stagger { get; }
        public double CarrierStagger { get; }
        public int PeakProjectileReservation { get; }
        public int ProgramCapacityUsed { get; }
        public int ProgramCapacityMaximum { get; }
        public BusterPowerSoftCap PowerSoftCap { get; }
        public BusterOccupancy Occupancy { get; }
    }

    public sealed class BusterAction
    {
        internal BusterAction(
            string actionId,
            string type,
            string scope,
            string moduleId,
            int count,
            double power,
            double totalPower,
            double damagePower,
            double range,
            double speed,
            string trajectory,
            bool guidance,
            BusterTriggerConfiguration trigger,
            BusterSplitterConfiguration splitter,
            BusterPayloadConfiguration payload,
            double stagger,
            string childActionId = null)
        {
            ActionId = actionId;
            Type = type;
            Scope = scope;
            ModuleId = moduleId;
            Count = count;
            Power = power;
            TotalPower = totalPower;
            DamagePower = damagePower;
            Range = range;
            Speed = speed;
            Trajectory = trajectory;
            Guidance = guidance;
            Trigger = trigger;
            Splitter = splitter;
            Payload = payload;
            Stagger = stagger;
            ChildActionId = childActionId;
        }

        public string ActionId { get; }
        public string Type { get; }
        public string Scope { get; }
        public string ModuleId { get; }
        public int Count { get; }
        public double Power { get; }
        public double TotalPower { get; }
        public double DamagePower { get; }
        public double Range { get; }
        public double Speed { get; }
        public string Trajectory { get; }
        public bool Guidance { get; }
        public BusterTriggerConfiguration Trigger { get; }
        public BusterSplitterConfiguration Splitter { get; }
        public BusterPayloadConfiguration Payload { get; }
        public double Stagger { get; }
        public string ChildActionId { get; }
    }

    public sealed class BusterProgramOrder
    {
        internal BusterProgramOrder(IEnumerable<string> root, IEnumerable<string> child)
        {
            Root = Array.AsReadOnly(new List<string>(root).ToArray());
            Child = Array.AsReadOnly(new List<string>(child).ToArray());
        }

        public IReadOnlyList<string> Root { get; }
        public IReadOnlyList<string> Child { get; }
    }

    public sealed class CompiledBusterPlan
    {
        internal CompiledBusterPlan(
            BusterBuildSource sourceBuild,
            bool isMegaBuster,
            BusterEmitterConfiguration emitter,
            bool rootGuidance,
            BusterTriggerConfiguration trigger,
            bool childGuidance,
            BusterSplitterConfiguration splitter,
            BusterPayloadConfiguration payload,
            BusterPacket rootPacket,
            BusterPacket carrierPacket,
            BusterPacket childPacket,
            BusterTrajectory trajectory,
            BusterStats stats,
            BusterProgramOrder programOrder,
            IEnumerable<BusterAction> actions,
            IEnumerable<BusterValidationIssue> warnings,
            string description)
        {
            SourceBuild = sourceBuild;
            SchemaVersion = sourceBuild.SchemaVersion;
            RulesetVersion = sourceBuild.RulesetVersion;
            BuildId = sourceBuild.BuildId;
            ChassisId = sourceBuild.ChassisId;
            WeaponKey = sourceBuild.BuildId;
            Revision = sourceBuild.Revision;
            IsMegaBuster = isMegaBuster;
            Emitter = emitter;
            RootGuidance = rootGuidance;
            Trigger = trigger;
            ChildGuidance = childGuidance;
            Splitter = splitter;
            Payload = payload;
            RootPacket = rootPacket;
            CarrierPacket = carrierPacket;
            ChildPacket = childPacket;
            Trajectory = trajectory;
            Stats = stats;
            ProgramOrder = programOrder;
            Actions = Array.AsReadOnly(new List<BusterAction>(actions).ToArray());
            Warnings = Array.AsReadOnly(new List<BusterValidationIssue>(warnings).ToArray());
            Description = description;
        }

        public int SchemaVersion { get; }
        public string RulesetVersion { get; }
        public string BuildId { get; }
        public string ChassisId { get; }
        public string WeaponKey { get; }
        public int Revision { get; }
        public int BuildRevision => Revision;
        public bool IsMegaBuster { get; }
        public BusterBuildSource SourceBuild { get; }
        public BusterEmitterConfiguration Emitter { get; }
        public bool RootGuidance { get; }
        public BusterTriggerConfiguration Trigger { get; }
        public bool ChildGuidance { get; }
        public BusterSplitterConfiguration Splitter { get; }
        public BusterPayloadConfiguration Payload { get; }
        public BusterPacket RootPacket { get; }
        public BusterPacket CarrierPacket { get; }
        public BusterPacket ChildPacket { get; }
        public BusterTrajectory Trajectory { get; }
        public BusterStats Stats { get; }
        public int PeakProjectileReservation => Stats.PeakProjectileReservation;
        public BusterProgramOrder ProgramOrder { get; }
        public IReadOnlyList<BusterAction> Actions { get; }
        public IReadOnlyList<BusterValidationIssue> Warnings { get; }
        public string Description { get; }
    }
}
