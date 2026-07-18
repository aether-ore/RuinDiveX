using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RuinCrawler.Core.Reaverbots
{
    public sealed class ReaverbotGenerator
    {
        public const int CandidateCount = 8;

        private const double GlobalMoveSpeedScale = 1.22d;

        private static readonly string[] NamePrefixes =
        {
            "AR", "BA", "DA", "GA", "KA", "KO", "MU", "NA", "OM", "RA", "SA", "TO", "UR", "VA", "ZA",
        };

        private static readonly string[] NameSuffixes =
        {
            "EN", "GAR", "KIR", "MOL", "ORA", "RAK", "TUM", "VAN", "XEL", "ZUN",
        };

        private static readonly HashSet<string> SpringMobilityIds = new HashSet<string>(
            new[] { "springQuadruped", "pairedSprings", "monoPogo", "launchLeg" },
            StringComparer.Ordinal);

        private static readonly HashSet<string> CrawlerMobilityIds = new HashSet<string>(
            new[] { "articulatedCrawler", "wheelBogies" },
            StringComparer.Ordinal);

        private static readonly IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> WeaponWeakPointWeights
            = BuildWeaponWeakPointWeights();

        private readonly ReaverbotCatalog _catalog;

        public ReaverbotGenerator(ReaverbotCatalog catalog)
        {
            _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        }

        public ReaverbotCatalog Catalog => _catalog;

        public ReaverbotGenome Generate(ReaverbotGenerationOptions options = null)
        {
            ReaverbotGenerationOptions context = (options ?? new ReaverbotGenerationOptions()).Snapshot();
            uint normalizedSeed = ReaverbotDeterminism.HashSeed(context.Seed);
            Candidate best = null;

            for (int candidateIndex = 0; candidateIndex < CandidateCount; candidateIndex += 1)
            {
                Candidate candidate = BuildCandidate(normalizedSeed, context, candidateIndex);
                if (best == null || candidate.Score > best.Score)
                {
                    best = candidate;
                }
            }

            if (best == null || !best.Validation.IsValid)
            {
                ReaverbotValidationResult validation = best?.Validation
                    ?? new ReaverbotValidationResult(new[] { "no-generation-candidates" }, Array.Empty<string>());
                throw new ReaverbotGenerationException(
                    "Unable to generate a valid Reaverbot: " + string.Join(", ", validation.Errors),
                    validation);
            }

            ApplyBodyDefenseOverrides(best.Genome);
            ReaverbotValidationResult finalValidation = Validate(best.Genome);
            if (!finalValidation.IsValid)
            {
                throw new ReaverbotGenerationException(
                    "Unable to apply Reaverbot body defense contract: "
                    + string.Join(", ", finalValidation.Errors),
                    finalValidation);
            }

            return best.Genome;
        }

        public ReaverbotValidationResult Validate(
            ReaverbotGenome genome,
            bool allowPendingBodyDefenseOverride = false)
        {
            var errors = new List<string>();
            var warnings = new List<string>();
            if (genome == null)
            {
                errors.Add("missing-genome");
                return new ReaverbotValidationResult(errors, warnings);
            }

            _catalog.BodyPlans.TryGetValue(genome.Body?.PlanId ?? string.Empty, out ReaverbotBodyPlanDefinition body);
            _catalog.Weapons.TryGetValue(genome.Modules?.Weapon?.Id ?? string.Empty, out ReaverbotWeaponDefinition weapon);
            _catalog.Defenses.TryGetValue(genome.Modules?.Defense?.Id ?? string.Empty, out ReaverbotDefenseDefinition defense);
            _catalog.WeakPoints.TryGetValue(genome.Modules?.WeakPoint?.Id ?? string.Empty, out ReaverbotWeakPointDefinition weakPoint);
            _catalog.Archetypes.TryGetValue(genome.ArchetypeId ?? string.Empty, out ReaverbotArchetypeDefinition archetype);
            ReaverbotChargeModule chargePayload = genome.Modules?.Charge;
            _catalog.ChargeModules.TryGetValue(chargePayload?.Id ?? string.Empty, out ReaverbotChargeModuleDefinition chargeDefinition);
            ReaverbotWeaponModule weaponPayload = genome.Modules?.Weapon;
            ReaverbotDefenseModule defensePayload = genome.Modules?.Defense;
            string mobilityId = genome.Body?.MobilityId;
            bool springMobility = string.Equals(genome.Body?.MovementModel, "springBounce", StringComparison.Ordinal)
                && SpringMobilityIds.Contains(mobilityId ?? string.Empty);
            bool crawlerMobility = CrawlerMobilityIds.Contains(mobilityId ?? string.Empty);
            bool wheelMobility = string.Equals(genome.Body?.MovementModel, "wheelDrive", StringComparison.Ordinal)
                && string.Equals(mobilityId, "wheelBogies", StringComparison.Ordinal);
            bool isClaw = string.Equals(weapon?.Id, "clawArm", StringComparison.Ordinal);
            bool isLaunchLeg = string.Equals(weapon?.Id, "launchLeg", StringComparison.Ordinal);
            bool usesQuadrupedEyelids = string.Equals(body?.Id, "quadruped", StringComparison.Ordinal)
                && string.Equals(defense?.Id, "armorShutters", StringComparison.Ordinal)
                && string.Equals(weakPoint?.Id, "eyeLens", StringComparison.Ordinal);

            if (genome.SchemaVersion != ReaverbotCatalog.SupportedSchemaVersion) errors.Add("unsupported-schema-version");
            if (archetype == null) errors.Add("unknown-archetype");
            if (body == null) errors.Add("unknown-body-plan");
            if (weapon == null) errors.Add("missing-weapon");
            if (string.Equals(weapon?.AttackKind, "charge", StringComparison.Ordinal) && chargeDefinition == null)
                errors.Add("charge-module-required");
            if (!string.Equals(weapon?.AttackKind, "charge", StringComparison.Ordinal) && chargePayload != null)
                errors.Add("charge-module-on-non-charge");
            if (chargeDefinition != null && body?.HasTag("aerial") == true && chargeDefinition.Id != "vectorRocket")
                errors.Add("aerial-vector-rocket-required");
            if (chargeDefinition != null
                && (body?.Id == "quadruped" || body?.Id == "crawler")
                && chargeDefinition.Id != "spineJet")
                errors.Add("quadruped-spine-jet-required");
            if (chargeDefinition != null
                && body?.HasTag("aerial") != true
                && body?.Id != "quadruped"
                && body?.Id != "crawler"
                && chargeDefinition.Id != "twinRocketPack")
                errors.Add("back-rocket-pack-required");
            if (isClaw && defensePayload != null) errors.Add("claw-defense-must-be-null");
            if (!isClaw && defensePayload == null) errors.Add("defense-null-non-claw");
            if (!isClaw && defensePayload != null && defense == null) errors.Add("missing-defense");
            if (weakPoint == null) errors.Add("missing-weak-point");
            if (isClaw && weakPoint?.Id != "clawPalm") errors.Add("claw-palm-weak-point-required");
            if (!isClaw && weakPoint?.Id == "clawPalm") errors.Add("claw-palm-non-claw");
            if (isLaunchLeg && weakPoint?.Id != "legJoint") errors.Add("launch-leg-joint-weak-point-required");
            if (isLaunchLeg && defense?.Id != "sidePlates") errors.Add("launch-leg-side-plates-required");
            if (!allowPendingBodyDefenseOverride && body?.Id == "quadruped" && !isClaw && defense?.Id != "armorShutters")
                errors.Add("quadruped-eyelid-defense-required");
            if (!allowPendingBodyDefenseOverride && body?.Id == "quadruped" && !isClaw && weakPoint?.Id != "eyeLens")
                errors.Add("quadruped-eye-weak-point-required");
            if (genome.Modules?.Eye?.Color != _catalog.EyeColor) errors.Add("red-eye-contract");
            if (genome.ArchetypeId == "pouncer" && !springMobility) errors.Add("pouncer-spring-mobility-required");
            if (weaponPayload?.AttackKind == "pounce" && !springMobility) errors.Add("pounce-spring-mobility-required");
            if (genome.ArchetypeId == "pouncer" && weaponPayload?.AttackKind != "pounce")
                errors.Add("pouncer-pounce-attack-required");
            if (genome.ArchetypeId == "pouncer"
                && (weaponPayload?.IntegratedIntoMobility != true || weaponPayload.MountRole != "locomotion"))
                errors.Add("pouncer-mobility-weapon-required");
            if (mobilityId == "springQuadruped" && body?.Id != "quadruped") errors.Add("spring-quadruped-body-incompatible");
            if ((mobilityId == "pairedSprings" || mobilityId == "monoPogo") && body?.Id != "hopper")
                errors.Add("hopper-spring-body-incompatible");
            if (mobilityId == "launchLeg"
                && (body?.Id != "hopper" || weapon?.Id != "launchLeg" || genome.Body?.MobilityLegCount != 1))
                errors.Add("launch-leg-mobility-contract");
            if (mobilityId == "monoPogo" && genome.Body?.MobilityLegCount != 1)
                errors.Add("mono-pogo-single-leg-required");
            if (crawlerMobility && body?.Id != "crawler") errors.Add("crawler-mobility-body-incompatible");
            if (genome.Body?.MovementModel == "wheelDrive" && mobilityId != "wheelBogies")
                errors.Add("wheel-drive-mobility-mismatch");
            if (mobilityId == "articulatedCrawler"
                && (genome.Body?.MovementModel != "groundStep" || genome.Body.MobilityLegCount != 6))
                errors.Add("articulated-crawler-contract");
            if (mobilityId == "wheelBogies"
                && (!wheelMobility
                    || genome.Body?.MobilityLegCount != 0
                    || genome.Body.MobilityWheelCount != 4
                    || genome.Body.NavigationMode != "ground"
                    || !ContractCollections.Contains(genome.Body.Tags, "wheeled")
                    || !ContractCollections.Contains(genome.Body.Tags, "rolling")))
                errors.Add("wheel-bogy-contract");
            if (body != null && weapon != null && !HasBodyRequirements(weapon, body))
                errors.Add("weapon-body-incompatible");
            if (body != null && defense != null && !HasBodyRequirements(defense, body))
                errors.Add("defense-body-incompatible");
            if (archetype != null && weapon != null && !ContractCollections.Contains(archetype.WeaponIds, weapon.Id))
                errors.Add("weapon-archetype-incompatible");
            if (archetype != null && defense != null
                && !ContractCollections.Contains(archetype.DefenseIds, defense.Id)
                && !usesQuadrupedEyelids)
                errors.Add("defense-archetype-incompatible");
            if (archetype != null && weakPoint != null
                && !ContractCollections.Contains(archetype.WeakPointIds, weakPoint.Id)
                && !usesQuadrupedEyelids)
                errors.Add("weak-point-archetype-incompatible");
            if (!isClaw && defense != null && weakPoint != null && !IsLinkedWeakPoint(defense.Id, weakPoint.Id))
                errors.Add("defense-weak-point-unpaired");
            if ((genome.Behavior?.ExposureDuration ?? 0d) < 0.6d) errors.Add("weak-point-window-too-short");
            if ((defense?.Uptime ?? 0d) > 0.7d) errors.Add("defense-uptime-too-high");
            if ((genome.Threat?.Spent ?? int.MaxValue) > (genome.Threat?.Budget ?? int.MinValue))
                errors.Add("threat-budget-exceeded");
            if (genome.ArchetypeId == "tractorController" && (genome.Context?.EncounterSize ?? 1) < 2)
                errors.Add("tractor-controller-alone");
            bool bossSafeOverload = genome.Context?.BossSafeOverload == true
                && genome.Context.BossProfileId == "overloadReliquary"
                && weapon?.Id == "overloadCore"
                && weaponPayload?.AttackKind == "bossOverload"
                && weaponPayload.BossSafe;
            if (genome.ArchetypeId == "aerialBomber"
                && (genome.Context?.IsBoss == true || genome.Context?.KeycardCarrier == true)
                && !bossSafeOverload)
                errors.Add("critical-self-destruct");
            if (genome.ArchetypeId == "tractorController"
                && (genome.Context?.IsBoss == true || genome.Context?.KeycardCarrier == true))
                errors.Add("critical-dependent-controller");
            if (weakPoint?.Location == "eye" && defense?.Id == "armoredSkull")
                warnings.Add("eye-near-front-armor");

            return new ReaverbotValidationResult(errors, warnings);
        }

        public bool HasBodyRequirements(ReaverbotWeaponDefinition module, ReaverbotBodyPlanDefinition body)
        {
            if (module == null || body == null) return false;
            return HasBodyRequirements(module.Requires, module.RequiresAny, module.BodyPlanIds, body);
        }

        public bool HasBodyRequirements(ReaverbotDefenseDefinition module, ReaverbotBodyPlanDefinition body)
        {
            if (module == null || body == null) return false;
            return HasBodyRequirements(module.Requires, module.RequiresAny, Array.Empty<string>(), body);
        }

        private Candidate BuildCandidate(uint normalizedSeed, ReaverbotGenerationOptions context, int candidateIndex)
        {
            string normalizedLabel = normalizedSeed.ToString(CultureInfo.InvariantCulture);
            var random = new ReaverbotSeededRandom(
                normalizedLabel + ":candidate:" + candidateIndex.ToString(CultureInfo.InvariantCulture));
            ReaverbotArchetypeDefinition archetype = PickArchetype(random.Fork("archetype"), context);
            ReaverbotBodyPlanDefinition bodyDefinition = PickBodyPlan(random.Fork("body"), archetype, context);
            ReaverbotWeaponDefinition weaponDefinition = PickWeapon(random.Fork("weapon"), archetype, bodyDefinition, context);
            ReaverbotWeaponModule weapon = CreateWeaponVariant(
                weaponDefinition,
                random.Fork("weaponVariant"),
                archetype,
                context);
            ReaverbotMobilityVariant mobility = CreateMobilityVariant(
                random.Fork("mobility"),
                archetype,
                bodyDefinition,
                context,
                weapon);
            ReaverbotChargeModule charge = CreateChargeModule(bodyDefinition, weapon, random.Fork("chargeModule"));
            ReaverbotDefenseModule defense = weapon.Id == "clawArm"
                ? null
                : weapon.Id == "launchLeg"
                    ? new ReaverbotDefenseModule(_catalog.Defenses["sidePlates"])
                    : new ReaverbotDefenseModule(PickDefense(random.Fork("defense"), archetype, bodyDefinition, context));
            ReaverbotWeakPointModule weakPoint = new ReaverbotWeakPointModule(PickWeakPoint(
                random.Fork("weakPoint"),
                archetype,
                defense?.Definition,
                weapon,
                context));
            ReaverbotProportions proportions = CreateProportions(random.Fork("proportions"), bodyDefinition);
            ReaverbotBehaviorGenome behavior = CreateBehavior(
                archetype,
                mobility,
                weapon,
                weakPoint.Definition,
                random.Fork("behavior"));
            ReaverbotStatsGenome stats = CreateStats(
                archetype,
                bodyDefinition,
                mobility,
                weapon,
                context.ThreatTier,
                proportions,
                context);
            int tier = Clamp(context.ThreatTier == 0 ? 1 : context.ThreatTier, 1, 8);
            int spent = archetype.ThreatCost
                + weapon.ThreatCost
                + (defense?.ThreatCost ?? 0)
                + Math.Max(1, tier - 1);
            int budget = 13
                + (tier * 3)
                + (context.Elite ? 5 : 0)
                + Clamp(context.BossBudgetBonus, 0, 16);
            ReaverbotPaletteDefinition palette = _catalog.Palettes[archetype.PaletteId];
            var body = new ReaverbotBodyGenome(
                bodyDefinition,
                bodyDefinition.HasTag("aerial") ? "air" : "ground",
                Unique(bodyDefinition.Tags.Concat(mobility.Tags)),
                mobility,
                proportions);
            var modules = new ReaverbotModuleGenome(
                new ReaverbotEyeModule(_catalog.EyeColor),
                weapon,
                charge,
                defense,
                weakPoint);
            var genome = new ReaverbotGenome(
                ReaverbotDeterminism.HashSeed(normalizedSeed),
                normalizedLabel,
                candidateIndex,
                CreateName(random.Fork("name"), archetype, tier),
                tier,
                new ReaverbotThreat(budget, spent),
                archetype,
                body,
                modules,
                palette,
                behavior,
                stats,
                new ReaverbotGenerationContext(context),
                Unique(
                    new[] { archetype.Id, archetype.Role }
                        .Concat(bodyDefinition.Tags)
                        .Concat(weapon.Tags)
                        .Concat(charge?.Tags ?? Array.Empty<string>())
                        .Concat(defense?.Tags ?? Array.Empty<string>())));

            ReaverbotValidationResult validation = Validate(genome, allowPendingBodyDefenseOverride: true);
            string defenseNoveltyId = defense?.Id ?? (weapon.Id == "clawArm" ? "integratedClawGuard" : null);
            int novelty = new[] { bodyDefinition.Id, mobility.Id, weapon.Id, defenseNoveltyId, weakPoint.Id }
                .Where(value => !string.IsNullOrEmpty(value))
                .Distinct(StringComparer.Ordinal)
                .Count();
            if (weapon.Id == "launchLeg" && mobility.Id == "launchLeg") novelty += 1;
            int coherence = weapon.Id == "clawArm" && weakPoint.Id == "clawPalm"
                ? 2
                : IsLinkedWeakPoint(defense?.Id, weakPoint.Id) ? 2 : 0;
            int weaponLink = IsWeaponLinkedWeakPoint(weapon.Id, weakPoint.Id) ? 2 : 0;
            double score = (validation.IsValid ? 100d : -validation.Errors.Count * 20d)
                + (novelty * 1.5d)
                + coherence
                + weaponLink
                + (weakPoint.Lockable ? 1d : 0d)
                + random.Range(0d, 0.25d);
            return new Candidate(genome, validation, score);
        }

        private ReaverbotArchetypeDefinition PickArchetype(
            ReaverbotSeededRandom random,
            ReaverbotGenerationOptions context)
        {
            if (!string.IsNullOrEmpty(context.ArchetypeId)
                && _catalog.Archetypes.TryGetValue(context.ArchetypeId, out ReaverbotArchetypeDefinition forced))
            {
                return forced;
            }

            IReadOnlyList<ReaverbotWeightedId> weights = GetArchetypeWeights(context);
            string id = random.Weighted(weights, "pursuer");
            return _catalog.Archetypes.TryGetValue(id ?? string.Empty, out ReaverbotArchetypeDefinition selected)
                ? selected
                : _catalog.Archetypes["pursuer"];
        }

        private IReadOnlyList<ReaverbotWeightedId> GetArchetypeWeights(ReaverbotGenerationOptions context)
        {
            if (!_catalog.IntentArchetypeWeights.TryGetValue(context.Intent ?? "any", out IReadOnlyList<ReaverbotWeightedId> source))
            {
                source = _catalog.IntentArchetypeWeights["any"];
            }

            var weights = source.Select(entry => new ReaverbotWeightedId(entry.Id, entry.Weight)).ToList();
            string text = GetContextText(context);
            if (ContainsAny(text, "nest", "swarm", "crawler", "pack")) Boost(weights, 2.2d, "packHunter", "pursuer");
            if (ContainsAny(text, "server", "sensor", "turret", "security"))
                Boost(weights, 1.8d, "shieldSentinel", "zoneController", "tractorController", "artillery");
            if (ContainsAny(text, "machine", "factory", "assembly", "heavy"))
                Boost(weights, 1.65d, "artillery", "shieldSentinel", "duelist");
            if (ContainsAny(text, "rolling", "wheel", "conveyor")) Boost(weights, 2.1d, "artillery");
            if (ContainsAny(text, "coolant", "fluid", "cryo", "electric", "energy"))
                Boost(weights, 1.9d, "zoneController", "aerialBomber", "tractorController");
            if (ContainsAny(text, "trap", "ambush", "hunting", "aggressive"))
                Boost(weights, 1.8d, "pouncer", "pursuer");
            if (ContainsAny(text, "flying", "aerial", "hover"))
                Boost(weights, 2.4d, "aerialBomber", "zoneController", "tractorController");
            if (context.IsBoss) Boost(weights, 2.6d, "duelist", "shieldSentinel", "artillery");

            string suppressed = JoinContext(context.SuppressedTags).ToLowerInvariant();
            if (ContainsAny(suppressed, "turret", "sensor", "security"))
                Boost(weights, 0.48d, "artillery", "shieldSentinel");
            if (ContainsAny(suppressed, "crawler", "swarm", "wild"))
                Boost(weights, 0.48d, "packHunter", "pursuer", "pouncer");
            if (ContainsAny(suppressed, "flying", "aerial", "hover"))
                Boost(weights, 0.42d, "aerialBomber", "zoneController", "tractorController");
            if (ContainsAny(suppressed, "large", "heavy", "guardian"))
                Boost(weights, 0.55d, "shieldSentinel", "artillery", "duelist");

            if (context.EncounterSize < 2) Remove(weights, "tractorController");
            if (context.IsBoss || context.KeycardCarrier)
            {
                Remove(weights, "aerialBomber");
                Remove(weights, "tractorController");
            }

            foreach (string id in context.ExcludedArchetypes ?? Array.Empty<string>()) Remove(weights, id);
            return ContractCollections.Freeze(weights);
        }

        private ReaverbotBodyPlanDefinition PickBodyPlan(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotGenerationOptions context)
        {
            if (!string.IsNullOrEmpty(context.BodyPlanId)
                && _catalog.BodyPlans.TryGetValue(context.BodyPlanId, out ReaverbotBodyPlanDefinition forced)
                && ContractCollections.Contains(archetype.BodyPlanIds, forced.Id))
            {
                return forced;
            }

            var compatible = archetype.BodyPlanIds
                .Where(_catalog.BodyPlans.ContainsKey)
                .Select(id => _catalog.BodyPlans[id])
                .ToArray();
            return random.Pick(compatible) ?? _catalog.BodyPlans["biped"];
        }

        private ReaverbotMobilityVariant CreateMobilityVariant(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotBodyPlanDefinition body,
            ReaverbotGenerationOptions context,
            ReaverbotWeaponModule weapon)
        {
            if (archetype.Id != "pouncer" && body.Id == "crawler")
            {
                string contextText = GetContextText(context);
                string suppressedText = JoinContext(context.SuppressedTags).ToLowerInvariant();
                double wheelChance = ContainsAny(suppressedText, "rolling", "wheel")
                    ? 0d
                    : ContainsAny(contextText, "rolling", "wheel", "conveyor") ? 0.78d : 0.46d;
                bool wheeled = random.Chance(wheelChance);
                return new ReaverbotMobilityVariant(
                    wheeled ? "wheelBogies" : "articulatedCrawler",
                    wheeled ? "Four-Wheel Bogy Drive" : "Six-Leg Crawler Linkage",
                    wheeled ? "wheelDrive" : "groundStep",
                    wheeled ? 0 : 6,
                    wheeled ? 4 : 0,
                    wheeled ? "wheelBogies" : "articulatedCrawler",
                    wheeled ? 1.18d : 1d,
                    wheeled ? 0.84d : 1d,
                    wheeled
                        ? new[] { "wheeled", "rolling", "traction", "wheelDrive", "lowProfile" }
                        : new[] { "articulated", "sixLegged", "terrainGrip" });
            }

            if (archetype.Id != "pouncer")
            {
                return new ReaverbotMobilityVariant(
                    "standard",
                    body.Label,
                    body.HasTag("aerial") ? "flight" : "groundStep",
                    null,
                    0,
                    body.Id,
                    1d,
                    1d,
                    Array.Empty<string>());
            }

            if (weapon.Id == "launchLeg")
            {
                return new ReaverbotMobilityVariant(
                    "launchLeg", "Launch Leg", "springBounce", 1, 0, "hopper", 0.9d, 0.82d,
                    new[] { "springLoaded", "bouncing", "singleLegged", "rocketAssisted", "massiveArticulatedLeg" });
            }

            if (body.Id == "quadruped")
            {
                return new ReaverbotMobilityVariant(
                    "springQuadruped", "Spring-Loaded Quadruped", "springBounce", 4, 0, "hopper", 1d, 1d,
                    new[] { "springLoaded", "bouncing" });
            }

            bool monoPogo = random.Chance(0.4d);
            return new ReaverbotMobilityVariant(
                monoPogo ? "monoPogo" : "pairedSprings",
                monoPogo ? "Mono-Pogo Chassis" : "Paired Spring Legs",
                "springBounce",
                monoPogo ? 1 : 2,
                0,
                "hopper",
                1d,
                1d,
                monoPogo
                    ? new[] { "springLoaded", "bouncing", "singleLegged" }
                    : new[] { "springLoaded", "bouncing" });
        }

        private ReaverbotWeaponDefinition PickWeapon(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotBodyPlanDefinition body,
            ReaverbotGenerationOptions context)
        {
            if (!string.IsNullOrEmpty(context.WeaponId)
                && _catalog.Weapons.TryGetValue(context.WeaponId, out ReaverbotWeaponDefinition forced)
                && ContractCollections.Contains(archetype.WeaponIds, forced.Id)
                && HasBodyRequirements(forced, body))
            {
                return forced;
            }

            var compatible = archetype.WeaponIds
                .Where(_catalog.Weapons.ContainsKey)
                .Select(id => _catalog.Weapons[id])
                .Where(weapon => HasBodyRequirements(weapon, body))
                .ToArray();
            return random.Pick(compatible) ?? _catalog.Weapons["pulseCannon"];
        }

        private static ReaverbotWeaponModule CreateWeaponVariant(
            ReaverbotWeaponDefinition weapon,
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotGenerationOptions context)
        {
            if (weapon.Id == "overloadCore" && context.BossSafeOverload)
            {
                return new ReaverbotWeaponModule(
                    weapon,
                    attackKind: "bossOverload",
                    tags: Unique(weapon.Tags.Where(tag => tag != "selfDestruct").Concat(new[] { "bossOverload" })),
                    bossSafe: true);
            }

            if (archetype.Id == "pouncer")
            {
                if (weapon.Id == "shockPiston")
                {
                    return new ReaverbotWeaponModule(
                        weapon,
                        attackKind: "pounce",
                        tags: Unique(weapon.Tags.Concat(new[] { "pounce", "landingShockwave" })),
                        range: 8.6d,
                        preferredRange: 4.5d,
                        damageScale: 1.08d,
                        mountRole: "locomotion",
                        integratedIntoMobility: true,
                        numericOverrides: new Dictionary<string, double>
                        {
                            ["landingRadius"] = 2.35d,
                            ["landingDamageScale"] = 1.08d,
                        });
                }

                if (weapon.Id == "pounceActuator")
                {
                    return new ReaverbotWeaponModule(
                        weapon,
                        mountRole: "locomotion",
                        integratedIntoMobility: true);
                }

                if (weapon.Id == "launchLeg")
                {
                    return new ReaverbotWeaponModule(
                        weapon,
                        mountRole: "locomotion",
                        integratedIntoMobility: true,
                        mountSide: random.Chance(0.5d) ? -1 : 1);
                }
            }

            if (weapon.Id == "clawArm")
            {
                return new ReaverbotWeaponModule(weapon, mountSide: random.Chance(0.5d) ? -1 : 1);
            }

            if (weapon.Id == "crusherJaw")
            {
                return new ReaverbotWeaponModule(
                    weapon,
                    jawVariant: random.Chance(0.5d) ? "canineFangCage" : "crusherTrap");
            }

            return new ReaverbotWeaponModule(weapon);
        }

        private ReaverbotChargeModule CreateChargeModule(
            ReaverbotBodyPlanDefinition body,
            ReaverbotWeaponModule weapon,
            ReaverbotSeededRandom random)
        {
            if (weapon.AttackKind != "charge") return null;
            ReaverbotChargeModuleDefinition definition = body.HasTag("aerial")
                ? _catalog.ChargeModules["vectorRocket"]
                : body.Id == "quadruped" || body.Id == "crawler"
                    ? _catalog.ChargeModules["spineJet"]
                    : _catalog.ChargeModules["twinRocketPack"];
            return new ReaverbotChargeModule(definition, Round(random.Range(0.94d, 1.16d), 3));
        }

        private ReaverbotDefenseDefinition PickDefense(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotBodyPlanDefinition body,
            ReaverbotGenerationOptions context)
        {
            if (!string.IsNullOrEmpty(context.DefenseId)
                && _catalog.Defenses.TryGetValue(context.DefenseId, out ReaverbotDefenseDefinition forced)
                && ContractCollections.Contains(archetype.DefenseIds, forced.Id)
                && HasBodyRequirements(forced, body))
            {
                return forced;
            }

            var compatible = archetype.DefenseIds
                .Where(_catalog.Defenses.ContainsKey)
                .Select(id => _catalog.Defenses[id])
                .Where(defense => HasBodyRequirements(defense, body)
                    && GetLinkedWeakPoints(defense.Id).Any(weight => ContractCollections.Contains(archetype.WeakPointIds, weight.Id)))
                .ToArray();
            return random.Pick(compatible)
                ?? compatible.FirstOrDefault()
                ?? _catalog.Defenses["reactivePlate"];
        }

        private ReaverbotWeakPointDefinition PickWeakPoint(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            ReaverbotDefenseDefinition defense,
            ReaverbotWeaponModule weapon,
            ReaverbotGenerationOptions context)
        {
            if (!string.IsNullOrEmpty(context.WeakPointId)
                && _catalog.WeakPoints.TryGetValue(context.WeakPointId, out ReaverbotWeakPointDefinition forced)
                && ContractCollections.Contains(archetype.WeakPointIds, forced.Id))
            {
                return forced;
            }

            if (weapon.Id == "clawArm") return _catalog.WeakPoints["clawPalm"];
            if (weapon.Id == "launchLeg") return _catalog.WeakPoints["legJoint"];
            IReadOnlyList<ReaverbotWeightedId> options = MergeWeightedWeakPoints(archetype, defense, weapon);
            string fallback = options.Count > 0 ? options[0].Id : archetype.WeakPointIds[0];
            string id = random.Weighted(options, fallback);
            return _catalog.WeakPoints.TryGetValue(id ?? string.Empty, out ReaverbotWeakPointDefinition selected)
                ? selected
                : _catalog.WeakPoints["eyeLens"];
        }

        private IReadOnlyList<ReaverbotWeightedId> MergeWeightedWeakPoints(
            ReaverbotArchetypeDefinition archetype,
            ReaverbotDefenseDefinition defense,
            ReaverbotWeaponModule weapon)
        {
            var combined = new List<ReaverbotWeightedId>();
            foreach (ReaverbotWeightedId entry in GetLinkedWeakPoints(defense?.Id))
            {
                if (ContractCollections.Contains(archetype.WeakPointIds, entry.Id))
                {
                    combined.Add(new ReaverbotWeightedId(entry.Id, entry.Weight));
                }
            }

            foreach (ReaverbotWeightedId weaponEntry in GetWeaponWeakPoints(weapon.Id))
            {
                int index = combined.FindIndex(entry => entry.Id == weaponEntry.Id);
                if (index >= 0)
                {
                    ReaverbotWeightedId prior = combined[index];
                    combined[index] = new ReaverbotWeightedId(prior.Id, prior.Weight + weaponEntry.Weight);
                }
            }

            return ContractCollections.Freeze(combined);
        }

        private static ReaverbotProportions CreateProportions(
            ReaverbotSeededRandom random,
            ReaverbotBodyPlanDefinition body)
        {
            bool agile = body.HasTag("agile");
            bool stable = body.HasTag("stablePose");
            return new ReaverbotProportions(
                Round(random.Range(0.88d, 1.12d), 4),
                Round(random.Range(stable ? 1.02d : 0.82d, stable ? 1.28d : 1.12d), 4),
                Round(random.Range(0.86d, body.HasTag("animal") ? 1.28d : 1.12d), 4),
                Round(random.Range(agile ? 1d : 0.86d, agile ? 1.24d : 1.1d), 4),
                Round(random.Range(0.84d, 1.16d), 4),
                random.RangeInclusive(1, 4),
                random.RangeInclusive(2, 5),
                Round(random.Range(0.04d, 0.2d), 4));
        }

        private static ReaverbotStatsGenome CreateStats(
            ReaverbotArchetypeDefinition archetype,
            ReaverbotBodyPlanDefinition body,
            ReaverbotMobilityVariant mobility,
            ReaverbotWeaponModule weapon,
            int threatTier,
            ReaverbotProportions proportions,
            ReaverbotGenerationOptions context)
        {
            int tier = Clamp(threatTier == 0 ? 1 : threatTier, 1, 8);
            double tierHealth = 1d + ((tier - 1) * 0.2d);
            double tierDamage = 1d + ((tier - 1) * 0.105d);
            double roomHealth = Clamp(context.HealthMultiplier, 0.72d, 1.6d);
            double bodyScale = body.RadiusScale * proportions.OverallScale * (weapon.RadiusScale ?? 1d);
            ReaverbotBaseStats stats = archetype.BaseStats;
            double attackRange = weapon.Range == 0d ? archetype.Behavior.PreferredRange : weapon.Range;
            bool melee = weapon.HasTag("melee");
            double healthScale = weapon.HealthScale ?? (melee ? 1.15d : 1d);
            double moveSpeedScale = weapon.MoveSpeedScale ?? 1d;
            double meleeArmorBonus = melee ? (weapon.MeleeArmorBonus ?? 20d) : 0d;
            double telegraphDuration = weapon.TelegraphDuration ?? archetype.Behavior.Telegraph;
            double commitDuration = weapon.CommitDuration ?? archetype.Behavior.Commit;
            double recoveryDuration = weapon.RecoveryDuration ?? archetype.Behavior.Recovery;
            double attackCooldownFloor = archetype.Behavior.AttackCooldownFloor == 0d
                ? 0.75d
                : archetype.Behavior.AttackCooldownFloor;
            double archetypeCooldownScale = archetype.Behavior.AttackCooldownScale == 0d
                ? 1d
                : archetype.Behavior.AttackCooldownScale;

            return new ReaverbotStatsGenome(
                Round(stats.Health * tierHealth * roomHealth * 1.12d * healthScale, 3),
                Round(stats.Damage * tierDamage * weapon.DamageScale * 1.1d, 3),
                Round(
                    stats.Speed
                    * GlobalMoveSpeedScale
                    * moveSpeedScale
                    * mobility.MoveSpeedScale
                    * (1d + Math.Min(0.16d, (tier - 1) * 0.025d)),
                    3),
                Round(attackRange, 3),
                Round(
                    Clamp(
                        (telegraphDuration + commitDuration + recoveryDuration)
                        * 0.9d
                        * (weapon.CooldownScale ?? 1d)
                        * archetypeCooldownScale,
                        attackCooldownFloor,
                        3.25d),
                    3),
                Round((stats.Armor + meleeArmorBonus) * (1d + ((tier - 1) * 0.12d)), 3),
                JsRound((4d + (archetype.ThreatCost * 1.4d)) * (1d + ((tier - 1) * 0.22d))),
                Round(stats.Radius * bodyScale, 3),
                Round(
                    (body.Height * proportions.OverallScale * (weapon.CollisionHeightScale ?? 1d))
                    + body.HoverHeight,
                    3));
        }

        private static ReaverbotBehaviorGenome CreateBehavior(
            ReaverbotArchetypeDefinition archetype,
            ReaverbotMobilityVariant mobility,
            ReaverbotWeaponModule weapon,
            ReaverbotWeakPointDefinition weakPoint,
            ReaverbotSeededRandom random)
        {
            ReaverbotArchetypeBehavior source = archetype.Behavior;
            string attackKind = weapon.AttackKind;
            double telegraph = weapon.TelegraphDuration ?? source.Telegraph;
            double commit = weapon.CommitDuration ?? source.Commit;
            double recovery = weapon.RecoveryDuration ?? source.Recovery;
            double aggroRange = attackKind == "charge"
                ? Math.Max(source.AggroRange, 26d)
                : attackKind == "pounce"
                    ? Math.Max(source.AggroRange, 24d)
                    : weapon.HasTag("melee") ? Math.Max(source.AggroRange, 22d) : source.AggroRange;
            double exposure = weakPoint.Exposure == "always"
                ? 99d
                : weakPoint.Exposure == "telegraph"
                    ? Math.Max(0.65d, telegraph)
                    : weakPoint.Exposure == "attack"
                        ? Math.Max(0.65d, telegraph + (commit * 0.45d))
                        : Math.Max(0.7d, recovery * 0.78d);
            double preferredRange = weapon.PreferredRange
                ?? (weapon.HasTag("ranged")
                    ? Math.Max(source.PreferredRange, weapon.Range * 0.66d)
                    : source.PreferredRange);
            return new ReaverbotBehaviorGenome(
                archetype,
                preferredRange,
                aggroRange,
                telegraph,
                commit,
                recovery,
                Round(exposure, 3),
                Round(source.TurnRate * mobility.TurnRateScale, 3),
                random.Chance(0.5d) ? -1 : 1,
                Round(random.Range(0.88d, 1.12d), 3));
        }

        private static string CreateName(
            ReaverbotSeededRandom random,
            ReaverbotArchetypeDefinition archetype,
            int threatTier)
        {
            string prefix = random.Pick(NamePrefixes);
            string suffix = random.Pick(NameSuffixes);
            int serial = random.RangeInclusive(1, 9 + (threatTier * 7));
            return prefix
                + "-"
                + suffix
                + " "
                + serial.ToString("00", CultureInfo.InvariantCulture)
                + " · "
                + archetype.Label;
        }

        private void ApplyBodyDefenseOverrides(ReaverbotGenome genome)
        {
            if (genome.Body.PlanId != "quadruped" || genome.Modules.Weapon.Id == "clawArm") return;
            int priorDefenseCost = genome.Modules.Defense?.ThreatCost ?? 0;
            var defense = new ReaverbotDefenseModule(_catalog.Defenses["armorShutters"]);
            var weakPoint = new ReaverbotWeakPointModule(_catalog.WeakPoints["eyeLens"]);
            genome.Modules.Defense = defense;
            genome.Modules.WeakPoint = weakPoint;
            genome.Behavior.ExposureDuration = Round(
                Math.Max(
                    0.65d,
                    genome.Behavior.TelegraphDuration + (genome.Behavior.CommitDuration * 0.45d)),
                3);
            genome.Threat = new ReaverbotThreat(
                genome.Threat.Budget,
                genome.Threat.Spent + defense.ThreatCost - priorDefenseCost);
            ReaverbotArchetypeDefinition archetype = _catalog.Archetypes[genome.ArchetypeId];
            genome.Tags = ContractCollections.Freeze(Unique(
                new[] { archetype.Id, archetype.Role }
                    .Concat(genome.Body.Tags)
                    .Concat(genome.Modules.Weapon.Tags)
                    .Concat(genome.Modules.Charge?.Tags ?? Array.Empty<string>())
                    .Concat(defense.Tags)));
        }

        private bool IsLinkedWeakPoint(string defenseId, string weakPointId)
        {
            if (string.IsNullOrEmpty(defenseId) || string.IsNullOrEmpty(weakPointId)) return false;
            return GetLinkedWeakPoints(defenseId).Any(entry => entry.Id == weakPointId);
        }

        private static bool IsWeaponLinkedWeakPoint(string weaponId, string weakPointId)
        {
            return GetWeaponWeakPoints(weaponId).Any(entry => entry.Id == weakPointId);
        }

        private IReadOnlyList<ReaverbotWeightedId> GetLinkedWeakPoints(string defenseId)
        {
            return !string.IsNullOrEmpty(defenseId)
                && _catalog.LinkedWeakPointWeights.TryGetValue(defenseId, out IReadOnlyList<ReaverbotWeightedId> weights)
                    ? weights
                    : Array.Empty<ReaverbotWeightedId>();
        }

        private static IReadOnlyList<ReaverbotWeightedId> GetWeaponWeakPoints(string weaponId)
        {
            return !string.IsNullOrEmpty(weaponId)
                && WeaponWeakPointWeights.TryGetValue(weaponId, out IReadOnlyList<ReaverbotWeightedId> weights)
                    ? weights
                    : Array.Empty<ReaverbotWeightedId>();
        }

        private static bool HasBodyRequirements(
            IReadOnlyList<string> required,
            IReadOnlyList<string> requiredAny,
            IReadOnlyList<string> bodyPlans,
            ReaverbotBodyPlanDefinition body)
        {
            foreach (string tag in required)
            {
                if (!body.HasTag(tag)) return false;
            }

            if (requiredAny.Count > 0 && !requiredAny.Any(body.HasTag)) return false;
            return bodyPlans.Count == 0 || ContractCollections.Contains(bodyPlans, body.Id);
        }

        private static string GetContextText(ReaverbotGenerationOptions context)
        {
            return JoinContext(
                new[] { context.Biome, context.RoomArchetypeId, context.RoomFlavorId }
                    .Concat(context.FavoredTags ?? Array.Empty<string>())
                    .Concat(context.BehaviorModifiers ?? Array.Empty<string>()))
                .ToLowerInvariant();
        }

        private static string JoinContext(IEnumerable<string> values)
        {
            return string.Join(" ", (values ?? Array.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)));
        }

        private static bool ContainsAny(string text, params string[] terms)
        {
            foreach (string term in terms)
            {
                if ((text ?? string.Empty).IndexOf(term, StringComparison.Ordinal) >= 0) return true;
            }

            return false;
        }

        private static void Boost(List<ReaverbotWeightedId> weights, double multiplier, params string[] ids)
        {
            var set = new HashSet<string>(ids, StringComparer.Ordinal);
            for (int index = 0; index < weights.Count; index += 1)
            {
                ReaverbotWeightedId entry = weights[index];
                if (set.Contains(entry.Id))
                {
                    weights[index] = new ReaverbotWeightedId(entry.Id, entry.Weight * multiplier);
                }
            }
        }

        private static void Remove(List<ReaverbotWeightedId> weights, string id)
        {
            weights.RemoveAll(entry => entry.Id == id);
        }

        private static IReadOnlyList<string> Unique(IEnumerable<string> values)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (string value in values ?? Array.Empty<string>())
            {
                if (!string.IsNullOrEmpty(value) && seen.Add(value)) result.Add(value);
            }

            return ContractCollections.Freeze(result);
        }

        private static int Clamp(int value, int minimum, int maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        private static double Clamp(double value, double minimum, double maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        private static double Round(double value, int digits)
        {
            return Math.Round(value, digits, MidpointRounding.AwayFromZero);
        }

        private static int JsRound(double value)
        {
            return (int)Math.Floor(value + 0.5d);
        }

        private static IReadOnlyDictionary<string, IReadOnlyList<ReaverbotWeightedId>> BuildWeaponWeakPointWeights()
        {
            var result = new Dictionary<string, IReadOnlyList<ReaverbotWeightedId>>(StringComparer.Ordinal)
            {
                ["rocketLance"] = Weights(("legJoint", 4d), ("rearBattery", 3d)),
                ["crusherJaw"] = Weights(("rearBattery", 3d), ("legJoint", 3d), ("eyeLens", 1d)),
                ["clawArm"] = Weights(("clawPalm", 10d)),
                ["pounceActuator"] = Weights(("bellyCore", 7d), ("legJoint", 2d)),
                ["launchLeg"] = Weights(("legJoint", 10d)),
                ["shockPiston"] = Weights(("bellyCore", 4d), ("legJoint", 3d)),
                ["pulseCannon"] = Weights(("ammoDrum", 3d), ("eyeLens", 2d), ("rearBattery", 2d)),
                ["mortarPod"] = Weights(("ammoDrum", 7d), ("rearBattery", 2d)),
                ["clusterMortar"] = Weights(("ammoDrum", 8d), ("rearBattery", 2d)),
                ["arcEmitter"] = Weights(("emitterCore", 6d), ("eyeLens", 2d)),
                ["flameNozzle"] = Weights(("coolingVents", 7d), ("rearBattery", 2d)),
                ["beamPrism"] = Weights(("eyeLens", 4d), ("emitterCore", 3d)),
                ["mineDispenser"] = Weights(("ammoDrum", 4d), ("rearBattery", 3d)),
                ["rotorBlade"] = Weights(("counterweightCore", 10d)),
                ["tractorMagnet"] = Weights(("emitterCore", 8d), ("eyeLens", 3d)),
                ["overloadCore"] = Weights(("overloadCore", 8d), ("eyeLens", 4d)),
            };
            return ContractCollections.Freeze(result);
        }

        private static IReadOnlyList<ReaverbotWeightedId> Weights(params (string id, double weight)[] entries)
        {
            return ContractCollections.Freeze(entries.Select(entry => new ReaverbotWeightedId(entry.id, entry.weight)));
        }

        private sealed class Candidate
        {
            public Candidate(ReaverbotGenome genome, ReaverbotValidationResult validation, double score)
            {
                Genome = genome;
                Validation = validation;
                Score = score;
            }

            public ReaverbotGenome Genome { get; }
            public ReaverbotValidationResult Validation { get; }
            public double Score { get; }
        }
    }
}
