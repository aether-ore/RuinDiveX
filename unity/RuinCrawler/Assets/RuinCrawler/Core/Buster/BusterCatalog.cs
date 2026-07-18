using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace RuinCrawler.Core.Buster
{
    public static class BusterRuleset
    {
        public const int SchemaVersion = 1;
        public const string RulesetVersion = "custom-buster-v0.2";
        public const int ChassisCapacity = 5;
        public const int TuningTotal = 16;
        public const int TuningMinimum = 1;
        public const int TuningMaximum = 10;
        public const double ChildRangeMultiplier = 0.65d;
        public const double PowerSoftCapKnee = 1.25d;
        public const double PowerSoftCapAsymptote = 1.5d;
        public const double PowerSoftCapSteepness = 4d;
        public const double TriggerWindowWarningSeconds = 0.1d;
        public const double TriggerTimeEpsilon = 1e-9d;
        public const double RechargeDelaySeconds = 0.65d;
        public const double RechargeDurationSeconds = 1.8d;
        public const int MaximumMovingProjectiles = 24;
        public const double LevelTenPowerScalar = 1d;

        public static double GetTuningMultiplier(int rating)
        {
            return 0.72d + (0.07d * rating);
        }

        public static double GetMaximumEnergy(int energyRating)
        {
            return 2d + energyRating;
        }

        public static double ApplyPowerSoftCap(double rawMultiplier)
        {
            if (double.IsNaN(rawMultiplier) || double.IsInfinity(rawMultiplier))
            {
                return 0d;
            }

            double raw = Math.Max(0d, rawMultiplier);
            if (raw <= PowerSoftCapKnee)
            {
                return raw;
            }

            double excess = raw - PowerSoftCapKnee;
            return PowerSoftCapKnee + (excess / (1d + (PowerSoftCapSteepness * excess)));
        }

        public static int GetCombatDepthLevel(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                return 1;
            }

            return Math.Max(1, Math.Min(10, (int)Math.Round(value, MidpointRounding.AwayFromZero)));
        }

        public static double GetCombatDepthScalar(double combatDepthLevel, double levelTenScalar = LevelTenPowerScalar)
        {
            int level = GetCombatDepthLevel(combatDepthLevel);
            double endpoint = double.IsNaN(levelTenScalar) || double.IsInfinity(levelTenScalar)
                ? LevelTenPowerScalar
                : Math.Max(1d, Math.Min(1.25d, levelTenScalar));
            return 1d + (((level - 1d) / 9d) * (endpoint - 1d));
        }
    }

    public enum BusterModuleKind
    {
        Emitter,
        Modifier,
        Trigger,
        Splitter,
        Payload
    }

    public sealed class BusterModuleDefinition
    {
        public BusterModuleDefinition(
            string id,
            string label,
            BusterModuleKind kind,
            double energyCost = 0d,
            double cycleDelay = 0d,
            bool physical = true,
            bool builtIn = false,
            int semanticCapacity = 1,
            IEnumerable<string> compatibleEmitterTags = null,
            double basePower = 0d,
            double baseRange = 0d,
            double baseRapid = 0d,
            double projectileSpeed = 0d,
            string trajectory = null,
            string nativePayload = null,
            IEnumerable<string> emitterTags = null,
            double powerMultiplier = 1d,
            string guidance = null,
            string triggerEvent = null,
            double delay = 0d,
            double carrierAllocation = 0d,
            double childTransfer = 0d,
            int projectileCount = 1,
            string pattern = null,
            IEnumerable<double> angleOffsets = null,
            int? radialCount = null,
            double totalPowerMultiplier = 1d,
            bool childOnly = false,
            string payload = null,
            double radius = 0d,
            bool replacesDirect = false)
        {
            Id = id;
            Label = label;
            Kind = kind;
            EnergyCost = energyCost;
            CycleDelay = cycleDelay;
            Physical = physical;
            BuiltIn = builtIn;
            SemanticCapacity = semanticCapacity;
            CompatibleEmitterTags = Copy(compatibleEmitterTags ?? new[] { "pulse", "ballistic" });
            BasePower = basePower;
            BaseRange = baseRange;
            BaseRapid = baseRapid;
            ProjectileSpeed = projectileSpeed;
            Trajectory = trajectory;
            NativePayload = nativePayload;
            EmitterTags = Copy(emitterTags ?? Array.Empty<string>());
            PowerMultiplier = powerMultiplier;
            Guidance = guidance;
            TriggerEvent = triggerEvent;
            Delay = delay;
            CarrierAllocation = carrierAllocation;
            ChildTransfer = childTransfer;
            ProjectileCount = projectileCount;
            Pattern = pattern;
            AngleOffsets = Copy(angleOffsets ?? Array.Empty<double>());
            RadialCount = radialCount;
            TotalPowerMultiplier = totalPowerMultiplier;
            ChildOnly = childOnly;
            Payload = payload;
            Radius = radius;
            ReplacesDirect = replacesDirect;
        }

        public string Id { get; }
        public string Label { get; }
        public BusterModuleKind Kind { get; }
        public double EnergyCost { get; }
        public double CycleDelay { get; }
        public bool Physical { get; }
        public bool BuiltIn { get; }
        public int SemanticCapacity { get; }
        public IReadOnlyList<string> CompatibleEmitterTags { get; }
        public double BasePower { get; }
        public double BaseRange { get; }
        public double BaseRapid { get; }
        public double ProjectileSpeed { get; }
        public string Trajectory { get; }
        public string NativePayload { get; }
        public IReadOnlyList<string> EmitterTags { get; }
        public double PowerMultiplier { get; }
        public string Guidance { get; }
        public string TriggerEvent { get; }
        public double Delay { get; }
        public double CarrierAllocation { get; }
        public double ChildTransfer { get; }
        public int ProjectileCount { get; }
        public string Pattern { get; }
        public IReadOnlyList<double> AngleOffsets { get; }
        public int? RadialCount { get; }
        public double TotalPowerMultiplier { get; }
        public bool ChildOnly { get; }
        public string Payload { get; }
        public double Radius { get; }
        public bool ReplacesDirect { get; }

        private static IReadOnlyList<T> Copy<T>(IEnumerable<T> values)
        {
            return Array.AsReadOnly(new List<T>(values).ToArray());
        }
    }

    public static class BusterModuleCatalog
    {
        private static readonly IReadOnlyDictionary<string, BusterModuleDefinition> DefinitionsValue =
            new ReadOnlyDictionary<string, BusterModuleDefinition>(
                new Dictionary<string, BusterModuleDefinition>(StringComparer.Ordinal)
                {
                    ["pulseBolt"] = new BusterModuleDefinition(
                        "pulseBolt", "Pulse Bolt", BusterModuleKind.Emitter,
                        energyCost: 2d, basePower: 8d, baseRange: 6.9d, baseRapid: 4.2d,
                        projectileSpeed: 9.5d, trajectory: "linear", nativePayload: "pulse",
                        emitterTags: new[] { "projectile", "pulse" }),
                    ["mortarShell"] = new BusterModuleDefinition(
                        "mortarShell", "Mortar Shell", BusterModuleKind.Emitter,
                        energyCost: 3d, basePower: 15d, baseRange: 6.2d, baseRapid: 1.15d,
                        projectileSpeed: 5.8d, trajectory: "ballistic", nativePayload: "ballistic",
                        emitterTags: new[] { "projectile", "ballistic", "mortar" }),
                    ["pursuitGuidance"] = new BusterModuleDefinition(
                        "pursuitGuidance", "Pursuit Guidance", BusterModuleKind.Modifier,
                        powerMultiplier: 0.9d, guidance: "pursuit"),
                    ["atApex"] = new BusterModuleDefinition(
                        "atApex", "At Apex", BusterModuleKind.Trigger,
                        cycleDelay: 0.08d, compatibleEmitterTags: new[] { "mortar" },
                        triggerEvent: "apex", carrierAllocation: 0d, childTransfer: 1d),
                    ["onImpact"] = new BusterModuleDefinition(
                        "onImpact", "Terminal Relay", BusterModuleKind.Trigger,
                        cycleDelay: 0.08d, physical: false, builtIn: true,
                        triggerEvent: "impact", carrierAllocation: 0.2d, childTransfer: 0.8d),
                    ["afterDelay"] = new BusterModuleDefinition(
                        "afterDelay", "After Delay", BusterModuleKind.Trigger,
                        cycleDelay: 0.08d, physical: false, builtIn: true,
                        triggerEvent: "delay", delay: 0.6d, carrierAllocation: 0d, childTransfer: 1.04d),
                    ["spread3"] = new BusterModuleDefinition(
                        "spread3", "Spread 3", BusterModuleKind.Splitter,
                        energyCost: 1d, cycleDelay: 0.08d, projectileCount: 3,
                        pattern: "spread", angleOffsets: new[] { -0.14d, 0d, 0.14d },
                        totalPowerMultiplier: 1.1d),
                    ["cluster5"] = new BusterModuleDefinition(
                        "cluster5", "Cluster 5", BusterModuleKind.Splitter,
                        energyCost: 2d, cycleDelay: 0.16d, projectileCount: 5,
                        pattern: "radial", radialCount: 5, totalPowerMultiplier: 1.2d,
                        childOnly: true),
                    ["pulsePayload"] = new BusterModuleDefinition(
                        "pulsePayload", "Native Pulse", BusterModuleKind.Payload,
                        physical: false, builtIn: true, semanticCapacity: 0,
                        payload: "pulse"),
                    ["explosion"] = new BusterModuleDefinition(
                        "explosion", "Explosion", BusterModuleKind.Payload,
                        energyCost: 1d, cycleDelay: 0.1d, payload: "explosion",
                        radius: 1.55d, replacesDirect: true)
                });

        public static IReadOnlyDictionary<string, BusterModuleDefinition> Definitions => DefinitionsValue;

        public static bool TryGet(string moduleId, out BusterModuleDefinition definition)
        {
            if (moduleId == null)
            {
                definition = null;
                return false;
            }

            return DefinitionsValue.TryGetValue(moduleId, out definition);
        }

        public static BusterModuleDefinition Get(string moduleId)
        {
            BusterModuleDefinition definition;
            return TryGet(moduleId, out definition) ? definition : null;
        }
    }

    public sealed class MegaBusterProfile
    {
        private MegaBusterProfile()
        {
        }

        public const string BuildId = "megaBuster";
        public const string ChassisId = "mega-buster-fixed";
        public const string EmitterModuleId = "pulseBolt";
        public const string ModuleInstanceId = "mega-pulse-core";
        public const int SocketCount = 4;

        public static BusterTuning NeutralTuning => new BusterTuning(4, 4, 4, 4);
    }
}
