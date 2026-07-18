using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;

namespace RuinCrawler.Core.Dungeon.V2.Tests
{
    public sealed class IndustrialFactoryV2GenerationTests
    {
        [Test]
        public void GoldenPlanContainsRequiredDistrictsWaterStatesRewardsAndShortcut()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("industrial-factory-v2-golden");
            IndustrialFactoryV2ValidationResult validation = new IndustrialFactoryV2Validator().Validate(plan);

            Assert.That(validation.Accepted, Is.True, Describe(validation));
            Assert.That(plan.Modules.Count, Is.InRange(DungeonPlanV2.MinimumModuleCount, DungeonPlanV2.MaximumModuleCount));
            Assert.That(plan.GameplayBeats, Has.Count.EqualTo(DungeonPlanV2.RequiredGameplayBeatCount));
            Assert.That(plan.Regions.Count, Is.InRange(12, 18));
            Assert.That(plan.Districts.Select(value => value.Kind), Does.Contain(DungeonBiomeDistrictKindV2.Factory));
            Assert.That(plan.Districts.Select(value => value.Kind), Does.Contain(DungeonBiomeDistrictKindV2.Waterworks));
            Assert.That(plan.Districts.Count(IsHazard), Is.EqualTo(1));

            DungeonFluidNetworkPlanV2 network = plan.FluidNetworks.Single();
            Assert.That(network.InitialConfigurationId, Is.EqualTo(IndustrialFactoryV2Ruleset.FreightSumpFilled));
            Assert.That(network.StableConfigurations.Select(value => value.Id), Is.EquivalentTo(new[]
            {
                IndustrialFactoryV2Ruleset.FreightSumpFilled,
                IndustrialFactoryV2Ruleset.StoredInReservoir,
                IndustrialFactoryV2Ruleset.GantrySumpFilled
            }));
            Assert.That(plan.Discoveries.Select(value => value.DurableRewardId),
                Does.Contain(IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId));
            Assert.That(plan.Discoveries.Select(value => value.DurableRewardId),
                Does.Contain(IndustrialFactoryV2Ruleset.CredentialKeyRewardId));
            Assert.That(plan.Shortcuts.Select(value => value.Id),
                Does.Contain(IndustrialFactoryV2Ruleset.WaterworksShortcutId));
            Assert.That(plan.FallExposures, Has.Count.EqualTo(16));
            Assert.That(plan.FallCatchments, Has.Count.EqualTo(4));
            foreach (string slug in new[]
                     {
                         "freight-sump",
                         "reservoir-service",
                         "gantry-sump",
                         "hazard-undercroft"
                     })
            {
                Assert.That(plan.FallExposures
                        .Where(value => value.Id.StartsWith("exposure-" + slug + "-", StringComparison.Ordinal))
                        .Select(value => value.Id),
                    Is.EquivalentTo(new[]
                    {
                        "exposure-" + slug + "-west",
                        "exposure-" + slug + "-east",
                        "exposure-" + slug + "-south",
                        "exposure-" + slug + "-north"
                    }), "Every side of each certified internal shaft aperture needs its own source-surface envelope.");
            }
            Assert.That(plan.Surfaces.Where(value => value.Id.EndsWith("-return-lift-platform", StringComparison.Ordinal))
                .All(value => value.Kind == DungeonSurfaceKindV2.Walkable), Is.True,
                "A return-lift landing remains stationary until a complete moving sweep is authored.");
            DungeonBiomeDistrictPlanV2 hazardDistrict = plan.Districts.Single(IsHazard);
            Assert.That(hazardDistrict.RegionIds, Has.Count.GreaterThanOrEqualTo(2));
            Assert.That(hazardDistrict.RegionIds
                .SelectMany(id => plan.Regions.Single(region => region.Id == id).ModuleInstanceIds)
                .Distinct(StringComparer.Ordinal).Count(), Is.EqualTo(1),
                "The shipped Undercroft is a certified multi-region vertical composition, not two fake macro rooms.");
            Assert.That(plan.Districts.Single(value => value.Kind == DungeonBiomeDistrictKindV2.Waterworks)
                .EntranceTransitionIds, Has.Count.GreaterThanOrEqualTo(2));
            Assert.That(plan.Anchors.Count(value => value.Kind == DungeonAnchorKindV2.Encounter), Is.GreaterThanOrEqualTo(5));
            Assert.That(plan.Anchors.Count(value => value.Kind == DungeonAnchorKindV2.Spawn), Is.EqualTo(1));
            Assert.That(plan.Anchors.Count(value => value.Kind == DungeonAnchorKindV2.Extraction), Is.EqualTo(1));
            Assert.That(plan.Anchors
                .Where(value => value.Kind == DungeonAnchorKindV2.Console)
                .All(value => !string.IsNullOrWhiteSpace(value.ProfileId)), Is.True);
        }

        [Test]
        public void FiniteSolverReachesExtractionWithoutDeadEndsOrProtectedBoundaryBypass()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("v2-progression-solver-golden");
            DungeonProgressionSolveResultV2 result = new DungeonProgressionSolverV2().Solve(plan);

            Assert.That(result.ReachableStateCount, Is.GreaterThan(1));
            Assert.That(result.ExtractionReachable, Is.True);
            Assert.That(result.ExtractionRegionStateCount,
                Is.GreaterThan(result.ExtractionReadyStateCount),
                "Standing in the Machine Core before its guardian/Refractor sequence must not count as extraction.");
            Assert.That(result.ExtractionReadyStateCount, Is.GreaterThan(0));
            Assert.That(result.DeadEndStateKeys, Is.Empty);
            Assert.That(result.ProtectedBoundaryViolations, Is.Empty);
        }

        [Test]
        public void StaticFallCoverageCertifiesErodedSafePadsAndStructuralClearance()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("v2-fall-coverage-golden");
            IReadOnlyList<IndustrialFactoryV2ValidationIssue> issues =
                new DungeonFallCoverageValidatorV2().Validate(plan);

            Assert.That(issues, Is.Empty, string.Join(" | ", issues.Select(value => value.ToString())));
        }

        [Test]
        public void SameSeedProducesEqualPlanAndDifferentSeedChangesSignature()
        {
            var generator = new IndustrialFactoryV2Generator();
            DungeonPlanV2 first = generator.Generate("stable-v2-seed");
            DungeonPlanV2 second = generator.Generate("stable-v2-seed");
            DungeonPlanV2 different = generator.Generate("different-v2-seed");

            Assert.That(first, Is.EqualTo(second));
            Assert.That(first.DeterministicSignature, Is.EqualTo(second.DeterministicSignature));
            Assert.That(first.DeterministicSignature, Is.Not.EqualTo(different.DeterministicSignature));
        }

        [Test]
        public void EverySelectedAuthoredModuleUsesADeclaredTopologyVariantAndDiscreteTransform()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator().Generate("module-variant-contract");

            foreach (DungeonModuleInstancePlanV2 module in plan.Modules)
            {
                Assert.That(
                    module.TemplateId.EndsWith("variant-a", StringComparison.Ordinal)
                    || module.TemplateId.EndsWith("variant-b", StringComparison.Ordinal),
                    Is.True,
                    module.TemplateId);
                Assert.That(module.Transform.QuarterTurns, Is.InRange(0, 3));
                Assert.That(module.RegionBindings.Select(value => value.PlacedRegionId),
                    Is.EquivalentTo(module.RegionIds), module.Id);
            }
        }

        [Test]
        [Timeout(600000)]
        public void ThousandSeedSweepIsValidDeterministicAndExercisesBothUndercrofts()
        {
            const int seedCount = 1000;
            var observations = new SeedSweepObservation[seedCount];
            var parallelOptions = new ParallelOptions
            {
                // Core generation and validation are pure. A bounded batch
                // keeps the 1,000-seed release gate exhaustive without doing
                // three serial full validations for every seed.
                MaxDegreeOfParallelism = Math.Max(1, Math.Min(Environment.ProcessorCount, 4))
            };
            Parallel.For(0, seedCount, parallelOptions, index =>
            {
                string seed = "industrial-factory-v2-sweep-" + index;
                try
                {
                    var checkedGenerator = new IndustrialFactoryV2Generator();
                    IndustrialFactoryV2GenerationResult generated = checkedGenerator.GenerateResult(seed);
                    if (!generated.Succeeded)
                    {
                        observations[index] = SeedSweepObservation.Failed(
                            seed,
                            generated.Failure == null
                                ? "Generation failed without a structured failure."
                                : string.Join(" | ", generated.Failure.LastErrors.Select(value => value.ToString())));
                        return;
                    }

                    DungeonPlanV2 first = generated.Plan;
                    // The accepted plan above already passed the complete
                    // validator. The replay needs only to reconstruct source
                    // deterministically; its signature must equal that accepted
                    // plan or the seed gate fails.
                    DungeonPlanV2 replay = new IndustrialFactoryV2Generator(
                        AcceptCandidateValidator.Instance).Generate(seed);
                    DungeonBiomeDistrictPlanV2 hazard = first.Districts.Single(IsHazard);
                    observations[index] = SeedSweepObservation.Succeeded(
                        seed,
                        generated.Attempts.Last().Validation.Accepted,
                        string.Equals(
                            first.DeterministicSignature,
                            replay.DeterministicSignature,
                            StringComparison.Ordinal),
                        first.Modules.Count,
                        first.Regions.Count,
                        first.Districts.Count,
                        first.Districts.Count(value => value.Kind == DungeonBiomeDistrictKindV2.Factory),
                        first.Districts.Count(value => value.Kind == DungeonBiomeDistrictKindV2.Waterworks),
                        first.Districts.Count(IsHazard),
                        hazard.Kind,
                        string.Join("|", first.AbstractRouteGraph.Edges
                            .OrderBy(value => value.Id, StringComparer.Ordinal)
                            .Select(value => value.FromNodeId + ">" + value.ToNodeId + ":" + value.Role)));
                }
                catch (Exception exception)
                {
                    observations[index] = SeedSweepObservation.Failed(seed, exception.ToString());
                }
            });

            var hazards = new HashSet<DungeonBiomeDistrictKindV2>();
            int minimumRegions = int.MaxValue;
            int maximumRegions = int.MinValue;
            var topologySignatures = new HashSet<string>(StringComparer.Ordinal);
            foreach (SeedSweepObservation observation in observations)
            {
                Assert.That(observation.Error, Is.Null, observation.Seed + ": " + observation.Error);
                Assert.That(observation.Accepted, Is.True, observation.Seed);
                Assert.That(observation.DeterministicReplay, Is.True, observation.Seed);
                Assert.That(observation.ModuleCount, Is.InRange(
                    DungeonPlanV2.MinimumModuleCount,
                    DungeonPlanV2.MaximumModuleCount), observation.Seed);
                Assert.That(observation.RegionCount, Is.InRange(12, 18), observation.Seed);
                Assert.That(observation.DistrictCount, Is.EqualTo(3), observation.Seed);
                Assert.That(observation.FactoryDistrictCount, Is.EqualTo(1), observation.Seed);
                Assert.That(observation.WaterworksDistrictCount, Is.EqualTo(1), observation.Seed);
                Assert.That(observation.HazardDistrictCount, Is.EqualTo(1), observation.Seed);

                hazards.Add(observation.HazardKind);
                topologySignatures.Add(observation.TopologySignature);
                minimumRegions = Math.Min(minimumRegions, observation.RegionCount);
                maximumRegions = Math.Max(maximumRegions, observation.RegionCount);
            }

            Assert.That(hazards, Is.EquivalentTo(new[]
            {
                DungeonBiomeDistrictKindV2.MagmaUndercroft,
                DungeonBiomeDistrictKindV2.ElectricalUndercroft
            }));
            Assert.That(minimumRegions, Is.GreaterThanOrEqualTo(DungeonPlanV2.MinimumRegionCount));
            Assert.That(maximumRegions, Is.LessThanOrEqualTo(DungeonPlanV2.MaximumRegionCount));
            Assert.That(topologySignatures.Count, Is.GreaterThanOrEqualTo(3));
        }

        private static bool IsHazard(DungeonBiomeDistrictPlanV2 district)
        {
            return district.Kind == DungeonBiomeDistrictKindV2.MagmaUndercroft
                || district.Kind == DungeonBiomeDistrictKindV2.ElectricalUndercroft;
        }

        private static string Describe(IndustrialFactoryV2ValidationResult validation)
        {
            return validation == null
                ? "No validation result."
                : string.Join(" | ", validation.Errors.Select(error => error.ToString()));
        }

        private sealed class AcceptCandidateValidator : IIndustrialFactoryV2CandidateValidator
        {
            public static readonly AcceptCandidateValidator Instance = new AcceptCandidateValidator();
            private static readonly IndustrialFactoryV2ValidationResult Accepted =
                new IndustrialFactoryV2ValidationResult(Array.Empty<IndustrialFactoryV2ValidationIssue>());

            public IndustrialFactoryV2ValidationResult Validate(DungeonPlanV2 plan) => Accepted;
        }

        private sealed class SeedSweepObservation
        {
            private SeedSweepObservation(string seed) { Seed = seed; }

            public string Seed { get; }
            public string Error { get; private set; }
            public bool Accepted { get; private set; }
            public bool DeterministicReplay { get; private set; }
            public int ModuleCount { get; private set; }
            public int RegionCount { get; private set; }
            public int DistrictCount { get; private set; }
            public int FactoryDistrictCount { get; private set; }
            public int WaterworksDistrictCount { get; private set; }
            public int HazardDistrictCount { get; private set; }
            public DungeonBiomeDistrictKindV2 HazardKind { get; private set; }
            public string TopologySignature { get; private set; }

            public static SeedSweepObservation Failed(string seed, string error) =>
                new SeedSweepObservation(seed) { Error = error ?? "Unknown failure." };

            public static SeedSweepObservation Succeeded(
                string seed,
                bool accepted,
                bool deterministicReplay,
                int moduleCount,
                int regionCount,
                int districtCount,
                int factoryDistrictCount,
                int waterworksDistrictCount,
                int hazardDistrictCount,
                DungeonBiomeDistrictKindV2 hazardKind,
                string topologySignature)
            {
                return new SeedSweepObservation(seed)
                {
                    Accepted = accepted,
                    DeterministicReplay = deterministicReplay,
                    ModuleCount = moduleCount,
                    RegionCount = regionCount,
                    DistrictCount = districtCount,
                    FactoryDistrictCount = factoryDistrictCount,
                    WaterworksDistrictCount = waterworksDistrictCount,
                    HazardDistrictCount = hazardDistrictCount,
                    HazardKind = hazardKind,
                    TopologySignature = topologySignature
                };
            }
        }
    }
}
