using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Campaign
{
    public enum DungeonRewardClaimScopeV1
    {
        OncePerExpedition = 0,
        OncePerRuin = 1
    }

    /// <summary>
    /// Typed durable effects for one dungeon discovery. Required facts/items
    /// stay on the active expedition; permanent facts and map knowledge are
    /// also copied to the matching KnownRuin record. Shortcut activation is
    /// expedition-local and never makes a route permanent in KnownRuin.
    /// </summary>
    public sealed class DungeonRewardGrantV1
    {
        public DungeonRewardGrantV1(
            int identifiedScrap = 0,
            IEnumerable<string> requiredFactIds = null,
            IEnumerable<string> requiredItemIds = null,
            IEnumerable<string> permanentFactIds = null,
            IEnumerable<string> currentExpeditionShortcutIds = null,
            IEnumerable<string> discoveredRecipeIds = null,
            IEnumerable<string> seenRegionIds = null,
            IEnumerable<string> visitedRegionIds = null,
            IEnumerable<string> exploredRegionIds = null,
            IEnumerable<string> discoveredConnectionIds = null,
            IEnumerable<string> knownLandmarkIds = null,
            IEnumerable<string> knownMechanismIds = null,
            bool securesLargeRefractor = false)
        {
            IdentifiedScrap = identifiedScrap;
            RequiredFactIds = Copy(requiredFactIds);
            RequiredItemIds = Copy(requiredItemIds);
            PermanentFactIds = Copy(permanentFactIds);
            CurrentExpeditionShortcutIds = Copy(currentExpeditionShortcutIds);
            DiscoveredRecipeIds = Copy(discoveredRecipeIds);
            SeenRegionIds = Copy(seenRegionIds);
            VisitedRegionIds = Copy(visitedRegionIds);
            ExploredRegionIds = Copy(exploredRegionIds);
            DiscoveredConnectionIds = Copy(discoveredConnectionIds);
            KnownLandmarkIds = Copy(knownLandmarkIds);
            KnownMechanismIds = Copy(knownMechanismIds);
            SecuresLargeRefractor = securesLargeRefractor;
        }

        public int IdentifiedScrap { get; }
        public IReadOnlyList<string> RequiredFactIds { get; }
        public IReadOnlyList<string> RequiredItemIds { get; }
        public IReadOnlyList<string> PermanentFactIds { get; }
        public IReadOnlyList<string> CurrentExpeditionShortcutIds { get; }
        public IReadOnlyList<string> DiscoveredRecipeIds { get; }
        public IReadOnlyList<string> SeenRegionIds { get; }
        public IReadOnlyList<string> VisitedRegionIds { get; }
        public IReadOnlyList<string> ExploredRegionIds { get; }
        public IReadOnlyList<string> DiscoveredConnectionIds { get; }
        public IReadOnlyList<string> KnownLandmarkIds { get; }
        public IReadOnlyList<string> KnownMechanismIds { get; }
        public bool SecuresLargeRefractor { get; }

        private static IReadOnlyList<string> Copy(IEnumerable<string> source)
        {
            return Array.AsReadOnly(source == null
                ? Array.Empty<string>()
                : new List<string>(source).ToArray());
        }
    }

    public sealed class DungeonRewardClaimRequestV1
    {
        public DungeonRewardClaimRequestV1(
            string ruinId,
            string discoveryId,
            string expeditionId,
            DungeonRewardClaimScopeV1 scope,
            DungeonRewardGrantV1 grant = null)
        {
            RuinId = ruinId;
            DiscoveryId = discoveryId;
            ExpeditionId = expeditionId;
            Scope = scope;
            Grant = grant ?? new DungeonRewardGrantV1();
        }

        public string RuinId { get; }
        public string DiscoveryId { get; }
        public string ExpeditionId { get; }
        public DungeonRewardClaimScopeV1 Scope { get; }
        public DungeonRewardGrantV1 Grant { get; }
    }

    public sealed class DungeonRewardTransactionResult
    {
        private DungeonRewardTransactionResult(
            bool success,
            bool changed,
            bool idempotentReplay,
            string failureCode,
            string message,
            CampaignStateV1 state,
            string claimKey,
            int identifiedScrapAwarded)
        {
            Success = success;
            Changed = changed;
            IdempotentReplay = idempotentReplay;
            FailureCode = failureCode;
            Message = message;
            State = state;
            ClaimKey = claimKey;
            IdentifiedScrapAwarded = identifiedScrapAwarded;
        }

        public bool Success { get; }
        public bool Changed { get; }
        public bool IdempotentReplay { get; }
        public string FailureCode { get; }
        public string Message { get; }
        public CampaignStateV1 State { get; }
        public string ClaimKey { get; }
        public int IdentifiedScrapAwarded { get; }

        internal static DungeonRewardTransactionResult Succeeded(
            CampaignStateV1 state,
            string claimKey,
            bool changed = true,
            bool idempotentReplay = false,
            int identifiedScrapAwarded = 0)
        {
            return new DungeonRewardTransactionResult(
                true,
                changed,
                idempotentReplay,
                null,
                null,
                state,
                claimKey,
                identifiedScrapAwarded);
        }

        internal static DungeonRewardTransactionResult Failed(
            CampaignStateV1 original,
            string failureCode,
            string message,
            string claimKey = null)
        {
            return new DungeonRewardTransactionResult(
                false,
                false,
                false,
                failureCode,
                message,
                original,
                claimKey,
                0);
        }
    }

    /// <summary>
    /// Pure clone-before-mutation transaction seam for DungeonPlanV2 discovery
    /// rewards. The composite claim key is stable across save/load and prevents
    /// duplicate grants without relying on scene object lifetime.
    /// </summary>
    public static class DungeonRewardTransactionService
    {
        private const string ClaimKeyPrefix = "drc1:";
        private const string ExpeditionClaimKeyPrefix = "drc1e:";
        public const string LargeRefractorOutcomeId = "large-refractor-secured";

        public static DungeonRewardTransactionResult ClaimDiscovery(
            CampaignStateV1 source,
            DungeonRewardClaimRequestV1 request)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            string validationFailure = ValidateRequest(request);
            if (validationFailure != null)
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "invalid-dungeon-reward",
                    validationFailure);
            }

            string ruinId = request.RuinId.Trim();
            string discoveryId = request.DiscoveryId.Trim();
            string expeditionId = request.ExpeditionId.Trim();
            string claimKey = request.Scope == DungeonRewardClaimScopeV1.OncePerExpedition
                ? CreateExpeditionClaimKey(expeditionId, ruinId, discoveryId)
                : CreateClaimKey(ruinId, discoveryId);
            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (!MatchesActiveExpedition(state, expeditionId, ruinId))
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "expedition-context-mismatch",
                    "The dungeon reward does not match the active expedition and ruin.",
                    claimKey);
            }

            KnownRuinV1 knownRuin = FindKnownRuin(state, ruinId);
            string identityFailure = ValidateKnownRuinIdentity(knownRuin, state.expedition);
            if (identityFailure != null)
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "ruin-plan-mismatch",
                    identityFailure,
                    claimKey);
            }

            bool alreadyClaimed = request.Scope == DungeonRewardClaimScopeV1.OncePerRuin
                ? knownRuin != null && Contains(knownRuin.claimedRewardIds, claimKey)
                : Contains(state.expedition.dungeonProgress.claimedRewardIds, claimKey);
            if (alreadyClaimed)
            {
                return DungeonRewardTransactionResult.Succeeded(
                    state,
                    claimKey,
                    changed: false,
                    idempotentReplay: true);
            }

            DungeonRewardGrantV1 grant = request.Grant;
            if (grant.IdentifiedScrap > int.MaxValue - state.salvage.identifiedScrap)
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "reward-overflow",
                    "The dungeon reward would overflow the identified scrap stockpile.",
                    claimKey);
            }

            knownRuin = knownRuin ?? CreateKnownRuin(state.expedition, ruinId);
            if (!state.knownRuins.Contains(knownRuin))
            {
                state.knownRuins.Add(knownRuin);
            }

            ApplyGrant(state, knownRuin, grant);
            AddUnique(state.expedition.dungeonProgress.claimedRewardIds, claimKey);
            if (request.Scope == DungeonRewardClaimScopeV1.OncePerRuin)
            {
                AddUnique(knownRuin.claimedRewardIds, claimKey);
            }

            return DungeonRewardTransactionResult.Succeeded(
                CampaignStateRepair.Repair(state),
                claimKey,
                identifiedScrapAwarded: grant.IdentifiedScrap);
        }

        public static DungeonRewardTransactionResult ResolveLargeRefractor(
            CampaignStateV1 source,
            string resolutionId,
            string ruinId,
            string discoveryId,
            string expeditionId,
            string resolvedAtUtc)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            if (string.IsNullOrWhiteSpace(resolutionId)
                || string.IsNullOrWhiteSpace(ruinId)
                || string.IsNullOrWhiteSpace(discoveryId)
                || string.IsNullOrWhiteSpace(expeditionId)
                || string.IsNullOrWhiteSpace(resolvedAtUtc))
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "invalid-refractor-resolution",
                    "Resolution, ruin, discovery, expedition, and timestamp are required.");
            }

            string normalizedResolutionId = resolutionId.Trim();
            string normalizedRuinId = ruinId.Trim();
            string normalizedDiscoveryId = discoveryId.Trim();
            string normalizedExpeditionId = expeditionId.Trim();
            string claimKey = CreateExpeditionClaimKey(
                normalizedExpeditionId,
                normalizedRuinId,
                normalizedDiscoveryId);
            CampaignStateV1 state = CampaignStateRepair.Repair(source.Clone());
            if (!MatchesActiveExpedition(state, normalizedExpeditionId, normalizedRuinId))
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "expedition-context-mismatch",
                    "The Large Refractor does not match the active expedition and ruin.",
                    claimKey);
            }

            ExpeditionResolutionHistoryV1 resolution = FindResolutionById(
                state,
                normalizedResolutionId);
            if (resolution != null && !MatchesResolution(
                    resolution,
                    normalizedRuinId,
                    normalizedDiscoveryId,
                    normalizedExpeditionId))
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    "resolution-id-conflict",
                    "The resolution id is already bound to a different dungeon result.",
                    claimKey);
            }

            ExpeditionResolutionHistoryV1 priorClaimResolution = FindResolution(
                state,
                normalizedRuinId,
                normalizedDiscoveryId,
                normalizedExpeditionId);
            if (priorClaimResolution != null)
            {
                return DungeonRewardTransactionResult.Succeeded(
                    state,
                    priorClaimResolution.claimKey,
                    changed: false,
                    idempotentReplay: true);
            }

            var claim = new DungeonRewardClaimRequestV1(
                normalizedRuinId,
                normalizedDiscoveryId,
                normalizedExpeditionId,
                DungeonRewardClaimScopeV1.OncePerExpedition,
                new DungeonRewardGrantV1(securesLargeRefractor: true));
            DungeonRewardTransactionResult claimed = ClaimDiscovery(state, claim);
            if (!claimed.Success)
            {
                return DungeonRewardTransactionResult.Failed(
                    source,
                    claimed.FailureCode,
                    claimed.Message,
                    claimKey);
            }

            state = claimed.State;
            KnownRuinV1 knownRuin = FindKnownRuin(state, normalizedRuinId);
            state.expedition.dungeonProgress.refractorSecured = true;
            knownRuin.refractorSecured = true;
            AddUnique(state.expedition.dungeonProgress.claimedRewardIds, claimKey);
            state.expeditionResolutionHistory.Add(new ExpeditionResolutionHistoryV1
            {
                resolutionId = normalizedResolutionId,
                expeditionId = normalizedExpeditionId,
                ruinId = normalizedRuinId,
                discoveryId = normalizedDiscoveryId,
                claimKey = claimKey,
                dungeonPlanId = state.expedition.dungeonPlanId,
                dungeonProfileId = state.expedition.dungeonProfileId,
                dungeonRulesetVersion = state.expedition.dungeonRulesetVersion,
                dungeonContentPackVersion = state.expedition.dungeonContentPackVersion,
                runSeed = state.expedition.runSeed,
                outcomeId = LargeRefractorOutcomeId,
                claimedRewardIds = new List<string> { claimKey },
                refractorSecured = true,
                resolvedAtUtc = resolvedAtUtc.Trim()
            });
            return DungeonRewardTransactionResult.Succeeded(
                CampaignStateRepair.Repair(state),
                claimKey,
                changed: true,
                idempotentReplay: claimed.IdempotentReplay);
        }

        public static string CreateClaimKey(string ruinId, string discoveryId)
        {
            if (string.IsNullOrWhiteSpace(ruinId))
            {
                throw new ArgumentException("A ruin id is required.", nameof(ruinId));
            }

            if (string.IsNullOrWhiteSpace(discoveryId))
            {
                throw new ArgumentException("A discovery id is required.", nameof(discoveryId));
            }

            string ruin = ruinId.Trim();
            string discovery = discoveryId.Trim();
            return ClaimKeyPrefix
                + ruin.Length + ":" + ruin
                + ":" + discovery.Length + ":" + discovery;
        }

        public static string CreateExpeditionClaimKey(
            string expeditionId,
            string ruinId,
            string discoveryId)
        {
            if (string.IsNullOrWhiteSpace(expeditionId))
            {
                throw new ArgumentException("An expedition id is required.", nameof(expeditionId));
            }

            if (string.IsNullOrWhiteSpace(ruinId))
            {
                throw new ArgumentException("A ruin id is required.", nameof(ruinId));
            }

            if (string.IsNullOrWhiteSpace(discoveryId))
            {
                throw new ArgumentException("A discovery id is required.", nameof(discoveryId));
            }

            string expedition = expeditionId.Trim();
            string ruin = ruinId.Trim();
            string discovery = discoveryId.Trim();
            return ExpeditionClaimKeyPrefix
                + expedition.Length + ":" + expedition
                + ":" + ruin.Length + ":" + ruin
                + ":" + discovery.Length + ":" + discovery;
        }

        public static bool IsClaimKey(string value)
        {
            return TryParseClaimKey(value, out _, out _, out _);
        }

        public static bool TryParseClaimKey(
            string value,
            out string ruinId,
            out string discoveryId,
            out string expeditionId)
        {
            ruinId = null;
            discoveryId = null;
            expeditionId = null;
            if (string.IsNullOrEmpty(value))
            {
                return false;
            }

            bool expeditionScoped = value.StartsWith(ExpeditionClaimKeyPrefix, StringComparison.Ordinal);
            if (!expeditionScoped && !value.StartsWith(ClaimKeyPrefix, StringComparison.Ordinal))
            {
                return false;
            }

            int cursor = expeditionScoped ? ExpeditionClaimKeyPrefix.Length : ClaimKeyPrefix.Length;
            if (expeditionScoped
                && (!TryReadLengthPrefixed(value, ref cursor, out expeditionId)
                    || cursor >= value.Length || value[cursor++] != ':'))
            {
                return false;
            }

            return TryReadLengthPrefixed(value, ref cursor, out ruinId)
                && cursor < value.Length && value[cursor++] == ':'
                && TryReadLengthPrefixed(value, ref cursor, out discoveryId)
                && cursor == value.Length;
        }

        private static bool TryReadLengthPrefixed(
            string value,
            ref int cursor,
            out string parsed)
        {
            parsed = null;
            int colon = value.IndexOf(':', cursor);
            if (colon <= cursor || !int.TryParse(value.Substring(cursor, colon - cursor), out int length)
                || length < 1)
            {
                return false;
            }

            int start = colon + 1;
            if (start > value.Length || length > value.Length - start)
            {
                return false;
            }

            parsed = value.Substring(start, length);
            cursor = start + length;
            return true;
        }

        private static string ValidateRequest(DungeonRewardClaimRequestV1 request)
        {
            if (request == null)
            {
                return "A dungeon reward request is required.";
            }

            if (string.IsNullOrWhiteSpace(request.RuinId)
                || string.IsNullOrWhiteSpace(request.DiscoveryId)
                || string.IsNullOrWhiteSpace(request.ExpeditionId))
            {
                return "Ruin, discovery, and expedition ids are required.";
            }

            if (request.Scope != DungeonRewardClaimScopeV1.OncePerExpedition
                && request.Scope != DungeonRewardClaimScopeV1.OncePerRuin)
            {
                return "The dungeon reward claim scope is unsupported.";
            }

            if (request.Grant == null || request.Grant.IdentifiedScrap < 0)
            {
                return "The dungeon reward grant is invalid.";
            }

            return ValidateIds(request.Grant.RequiredFactIds)
                ?? ValidateIds(request.Grant.RequiredItemIds)
                ?? ValidateIds(request.Grant.PermanentFactIds)
                ?? ValidateIds(request.Grant.CurrentExpeditionShortcutIds)
                ?? ValidateIds(request.Grant.DiscoveredRecipeIds)
                ?? ValidateIds(request.Grant.SeenRegionIds)
                ?? ValidateIds(request.Grant.VisitedRegionIds)
                ?? ValidateIds(request.Grant.ExploredRegionIds)
                ?? ValidateIds(request.Grant.DiscoveredConnectionIds)
                ?? ValidateIds(request.Grant.KnownLandmarkIds)
                ?? ValidateIds(request.Grant.KnownMechanismIds);
        }

        private static string ValidateIds(IReadOnlyList<string> values)
        {
            for (int index = 0; index < values.Count; index += 1)
            {
                if (string.IsNullOrWhiteSpace(values[index]))
                {
                    return "Dungeon reward effect ids cannot be empty.";
                }
            }

            return null;
        }

        private static bool MatchesActiveExpedition(
            CampaignStateV1 state,
            string expeditionId,
            string ruinId)
        {
            return string.Equals(state.expedition.expeditionId, expeditionId, StringComparison.Ordinal)
                && string.Equals(state.expedition.ruinId, ruinId, StringComparison.Ordinal);
        }

        private static KnownRuinV1 FindKnownRuin(CampaignStateV1 state, string ruinId)
        {
            return state.knownRuins.Find(value => value != null
                && string.Equals(value.ruinId, ruinId, StringComparison.Ordinal));
        }

        private static KnownRuinV1 CreateKnownRuin(ExpeditionSourceStateV1 expedition, string ruinId)
        {
            return new KnownRuinV1
            {
                ruinId = ruinId,
                dungeonPlanId = expedition.dungeonPlanId,
                dungeonProfileId = expedition.dungeonProfileId,
                dungeonRulesetVersion = expedition.dungeonRulesetVersion,
                dungeonContentPackVersion = expedition.dungeonContentPackVersion,
                runSeed = expedition.runSeed
            };
        }

        private static string ValidateKnownRuinIdentity(
            KnownRuinV1 ruin,
            ExpeditionSourceStateV1 expedition)
        {
            if (ruin == null)
            {
                return null;
            }

            return Conflicts(ruin.dungeonPlanId, expedition.dungeonPlanId)
                || Conflicts(ruin.dungeonProfileId, expedition.dungeonProfileId)
                || Conflicts(ruin.dungeonRulesetVersion, expedition.dungeonRulesetVersion)
                || Conflicts(ruin.dungeonContentPackVersion, expedition.dungeonContentPackVersion)
                || Conflicts(ruin.runSeed, expedition.runSeed)
                ? "The known ruin id is already bound to a different plan identity."
                : null;
        }

        private static bool Conflicts(string left, string right)
        {
            return !string.IsNullOrEmpty(left) && !string.IsNullOrEmpty(right)
                && !string.Equals(left, right, StringComparison.Ordinal);
        }

        private static void ApplyGrant(
            CampaignStateV1 state,
            KnownRuinV1 knownRuin,
            DungeonRewardGrantV1 grant)
        {
            ActiveDungeonProgressV1 progress = state.expedition.dungeonProgress;
            state.salvage.identifiedScrap += grant.IdentifiedScrap;
            AddUnique(state.discoveredRecipeIds, grant.DiscoveredRecipeIds);
            AddUnique(progress.requiredFactIds, grant.RequiredFactIds);
            AddUnique(progress.requiredItemIds, grant.RequiredItemIds);
            AddUnique(progress.permanentFactIds, grant.PermanentFactIds);
            AddUnique(progress.activatedShortcutIds, grant.CurrentExpeditionShortcutIds);
            AddMapKnowledge(progress.mapKnowledge, grant);

            AddUnique(knownRuin.permanentFactIds, grant.PermanentFactIds);
            AddMapKnowledge(knownRuin.mapKnowledge, grant);
            if (grant.SecuresLargeRefractor)
            {
                progress.refractorSecured = true;
                knownRuin.refractorSecured = true;
            }
        }

        private static void AddMapKnowledge(
            DungeonMapKnowledgeV1 knowledge,
            DungeonRewardGrantV1 grant)
        {
            AddUnique(knowledge.seenRegionIds, grant.SeenRegionIds);
            AddUnique(knowledge.seenRegionIds, grant.VisitedRegionIds);
            AddUnique(knowledge.seenRegionIds, grant.ExploredRegionIds);
            AddUnique(knowledge.visitedRegionIds, grant.VisitedRegionIds);
            AddUnique(knowledge.visitedRegionIds, grant.ExploredRegionIds);
            AddUnique(knowledge.exploredRegionIds, grant.ExploredRegionIds);
            AddUnique(knowledge.discoveredConnectionIds, grant.DiscoveredConnectionIds);
            AddUnique(knowledge.knownLandmarkIds, grant.KnownLandmarkIds);
            AddUnique(knowledge.knownMechanismIds, grant.KnownMechanismIds);
        }

        private static ExpeditionResolutionHistoryV1 FindResolutionById(
            CampaignStateV1 state,
            string resolutionId)
        {
            return state.expeditionResolutionHistory.Find(value => value != null
                && string.Equals(value.resolutionId, resolutionId, StringComparison.Ordinal));
        }

        private static ExpeditionResolutionHistoryV1 FindResolution(
            CampaignStateV1 state,
            string ruinId,
            string discoveryId,
            string expeditionId)
        {
            return state.expeditionResolutionHistory.Find(value => value != null
                && string.Equals(value.ruinId, ruinId, StringComparison.Ordinal)
                && string.Equals(value.discoveryId, discoveryId, StringComparison.Ordinal)
                && string.Equals(value.expeditionId, expeditionId, StringComparison.Ordinal));
        }

        private static bool MatchesResolution(
            ExpeditionResolutionHistoryV1 resolution,
            string ruinId,
            string discoveryId,
            string expeditionId)
        {
            return string.Equals(resolution.ruinId, ruinId, StringComparison.Ordinal)
                && string.Equals(resolution.discoveryId, discoveryId, StringComparison.Ordinal)
                && string.Equals(resolution.expeditionId, expeditionId, StringComparison.Ordinal);
        }

        private static void AddUnique(List<string> target, IEnumerable<string> values)
        {
            foreach (string value in values)
            {
                AddUnique(target, value.Trim());
            }
        }

        private static void AddUnique(List<string> target, string value)
        {
            if (!Contains(target, value))
            {
                target.Add(value);
                target.Sort(StringComparer.Ordinal);
            }
        }

        private static bool Contains(List<string> values, string value)
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
