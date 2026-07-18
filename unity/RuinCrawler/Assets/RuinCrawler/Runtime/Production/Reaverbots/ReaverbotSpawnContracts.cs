using System;
using System.Collections.Generic;
using System.Globalization;
using RuinCrawler.Core.Reaverbots;

namespace RuinCrawler.Runtime.Reaverbots
{
    [Serializable]
    public sealed class ReaverbotSpawnRequest
    {
        public string runSeed = "expedition";
        public string encounterId = "encounter";
        public int slotIndex;
        public int threatTier = 1;
        public string intent = "any";
        public int encounterSize = 1;
        public string biome;
        public string roomArchetypeId;
        public string roomFlavorId;
        public bool elite;
        public bool isBoss;
        public bool keycardCarrier;
        public double healthMultiplier = 1d;
        public int bossBudgetBonus;
        public string bossProfileId;
        public bool bossSafeOverload;
        public string archetypeId;
        public string bodyPlanId;
        public string weaponId;
        public string defenseId;
        public string weakPointId;
        public string displayNameOverride;
        public string stableSpawnIdOverride;
        public string generationSeedOverride;

        public uint EncounterSlotSeed => ReaverbotDeterminism.CreateEncounterSlotSeed(
            runSeed,
            encounterId,
            slotIndex);

        public string StableSpawnId => string.IsNullOrWhiteSpace(stableSpawnIdOverride)
            ? string.Join(
                ":",
                "encounter-reaverbot",
                ReaverbotDeterminism.HashSeed(runSeed).ToString("X8", CultureInfo.InvariantCulture),
                ReaverbotDeterminism.HashSeed(encounterId).ToString("X8", CultureInfo.InvariantCulture),
                slotIndex.ToString(CultureInfo.InvariantCulture))
            : stableSpawnIdOverride.Trim();

        public ReaverbotGenerationOptions CreateGenerationOptions()
        {
            return new ReaverbotGenerationOptions
            {
                Seed = string.IsNullOrWhiteSpace(generationSeedOverride)
                    ? EncounterSlotSeed.ToString(CultureInfo.InvariantCulture)
                    : generationSeedOverride.Trim(),
                ThreatTier = Math.Max(1, threatTier),
                Intent = string.IsNullOrWhiteSpace(intent) ? "any" : intent,
                EncounterSize = Math.Max(1, encounterSize),
                Biome = biome,
                RoomArchetypeId = roomArchetypeId,
                RoomFlavorId = roomFlavorId,
                Elite = elite,
                IsBoss = isBoss,
                KeycardCarrier = keycardCarrier,
                HealthMultiplier = healthMultiplier,
                BossBudgetBonus = bossBudgetBonus,
                BossProfileId = NullIfBlank(bossProfileId),
                BossSafeOverload = bossSafeOverload,
                ArchetypeId = NullIfBlank(archetypeId),
                BodyPlanId = NullIfBlank(bodyPlanId),
                WeaponId = NullIfBlank(weaponId),
                DefenseId = NullIfBlank(defenseId),
                WeakPointId = NullIfBlank(weakPointId),
            };
        }

        public static ReaverbotSpawnRequest SharukurusuStyle(
            string runSeed = "unity-port-fixed",
            string encounterId = "test-range-sharukurusu",
            int slotIndex = 0)
        {
            return new ReaverbotSpawnRequest
            {
                runSeed = runSeed,
                encounterId = encounterId,
                slotIndex = slotIndex,
                threatTier = 3,
                intent = "fast",
                encounterSize = 1,
                archetypeId = "duelist",
                bodyPlanId = "lowBiped",
                weaponId = "clawArm",
                weakPointId = "clawPalm",
                displayNameOverride = "Sharukurusu-style Reaverbot",
            };
        }

        private static string NullIfBlank(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }
    }

    /// <summary>
    /// Field recovery remains unidentified. Candidate provenance is retained
    /// for Roll's later transaction, while presentation only sees the generic
    /// recovery label.
    /// </summary>
    public sealed class UnidentifiedReaverbotRecovery
    {
        public UnidentifiedReaverbotRecovery(
            string recoveryId,
            string sourceGenomeId,
            string sourceSpawnId,
            IReadOnlyList<ReaverbotSalvageCandidate> candidates)
        {
            if (string.IsNullOrWhiteSpace(recoveryId))
            {
                throw new ArgumentException("A stable recovery id is required.", nameof(recoveryId));
            }

            RecoveryId = recoveryId;
            SourceGenomeId = sourceGenomeId ?? string.Empty;
            SourceSpawnId = sourceSpawnId ?? string.Empty;
            Candidates = candidates ?? Array.Empty<ReaverbotSalvageCandidate>();
        }

        public string RecoveryId { get; }
        public string SourceGenomeId { get; }
        public string SourceSpawnId { get; }
        public string DisplayName => "Unidentified Reaverbot Recovery";
        public IReadOnlyList<ReaverbotSalvageCandidate> Candidates { get; }
    }
}
