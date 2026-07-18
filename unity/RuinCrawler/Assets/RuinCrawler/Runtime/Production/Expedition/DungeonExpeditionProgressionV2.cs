using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Persistence;

namespace RuinCrawler.Runtime.Expedition
{
    public enum DungeonDiscoveryEffectKindV2
    {
        UnidentifiedSalvage,
        IdentifiedScrap,
        RecipeBlueprint,
        LoreFact,
        Shortcut,
        Landmark,
        MechanismCredential
    }

    /// <summary>
    /// Typed runtime command produced from one immutable V2 discovery plan.
    /// The central reward transaction owns claim idempotency; the optional
    /// field recovery is appended only after that transaction reports a new
    /// claim, so it cannot be duplicated by scene re-entry.
    /// </summary>
    public sealed class DungeonDiscoveryCommandV2
    {
        internal DungeonDiscoveryCommandV2(
            DungeonDiscoveryPlanV2 discovery,
            DungeonDiscoveryEffectKindV2 effectKind,
            DungeonRewardClaimRequestV1 rewardRequest,
            DungeonRewardClaimRequestV1 currentExpeditionActivationRequest,
            UnidentifiedRecoveryV1 fieldRecovery)
        {
            Discovery = discovery;
            EffectKind = effectKind;
            RewardRequest = rewardRequest;
            CurrentExpeditionActivationRequest = currentExpeditionActivationRequest;
            FieldRecovery = fieldRecovery;
        }

        public DungeonDiscoveryPlanV2 Discovery { get; }
        public DungeonDiscoveryEffectKindV2 EffectKind { get; }
        public DungeonRewardClaimRequestV1 RewardRequest { get; }
        public DungeonRewardClaimRequestV1 CurrentExpeditionActivationRequest { get; }
        public UnidentifiedRecoveryV1 FieldRecovery { get; }

        internal void ApplySupplementalEffects(CampaignStateV1 state)
        {
            if (FieldRecovery == null || state == null)
            {
                return;
            }

            state.unidentifiedRecoveries ??= new List<UnidentifiedRecoveryV1>();
            if (state.unidentifiedRecoveries.Any(value => value != null
                && string.Equals(value.recoveryId, FieldRecovery.recoveryId, StringComparison.Ordinal)))
            {
                return;
            }

            state.unidentifiedRecoveries.Add(FieldRecovery.Clone());
            state.unidentifiedRecoveries.Sort((left, right) =>
            {
                int sequence = (left?.sequence ?? long.MaxValue)
                    .CompareTo(right?.sequence ?? long.MaxValue);
                return sequence != 0
                    ? sequence
                    : string.CompareOrdinal(left?.recoveryId, right?.recoveryId);
            });
        }
    }

    public static class DungeonDiscoveryCommandMapperV2
    {
        public const string ShortcutActivationClaimSuffix = ":activation";

        public static bool TryMap(
            DungeonPlanV2 plan,
            DungeonDiscoveryPlanV2 discovery,
            CampaignStateV1 campaign,
            out DungeonDiscoveryCommandV2 command,
            out string failureCode,
            out string message)
        {
            command = null;
            failureCode = null;
            message = null;
            if (plan == null || discovery == null || campaign?.expedition == null)
            {
                return Fail(
                    "invalid-discovery-context",
                    "A plan, discovery, and active campaign expedition are required.",
                    out failureCode,
                    out message);
            }

            ExpeditionSourceStateV1 expedition = campaign.expedition;
            if (string.IsNullOrWhiteSpace(expedition.expeditionId)
                || string.IsNullOrWhiteSpace(expedition.ruinId))
            {
                return Fail(
                    "invalid-discovery-context",
                    "The active expedition must have stable expedition and ruin ids.",
                    out failureCode,
                    out message);
            }

            if (discovery.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.Repeatable)
            {
                return Fail(
                    "repeatable-discovery-unsupported",
                    "Repeatable discoveries require a quantity ledger and cannot use durable once-only claims.",
                    out failureCode,
                    out message);
            }

            DungeonAnchorPlanV2 anchor = plan.Anchors.FirstOrDefault(value =>
                string.Equals(value.Id, discovery.LocationAnchorId, StringComparison.Ordinal));
            if (anchor == null)
            {
                return Fail(
                    "unknown-discovery-anchor",
                    "The discovery anchor is not present in the active plan.",
                    out failureCode,
                    out message);
            }

            DungeonRewardClaimScopeV1 scope =
                discovery.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerExpedition
                ? DungeonRewardClaimScopeV1.OncePerExpedition
                : DungeonRewardClaimScopeV1.OncePerRuin;
            string rewardId = discovery.DurableRewardId;
            int identifiedScrap = 0;
            var requiredItems = new List<string>();
            var permanentFacts = new List<string>();
            var currentExpeditionShortcuts = new List<string>();
            var recipes = new List<string>();
            var landmarks = new List<string>();
            var mechanisms = new List<string>();
            UnidentifiedRecoveryV1 recovery = null;
            DungeonDiscoveryEffectKindV2 effectKind;

            switch (discovery.Kind)
            {
                case DungeonDiscoveryKindV2.Salvage:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    recovery = BuildKnownFieldRecovery(
                        expedition.ruinId,
                        discovery,
                        rewardId);
                    if (recovery != null)
                    {
                        effectKind = DungeonDiscoveryEffectKindV2.UnidentifiedSalvage;
                    }
                    else
                    {
                        // Generic curated caches have no physical-part catalog
                        // entry yet. CompletionSignificance is used as the
                        // bounded fungible amount until that catalog exists.
                        identifiedScrap = discovery.CompletionSignificance;
                        effectKind = DungeonDiscoveryEffectKindV2.IdentifiedScrap;
                    }
                    break;

                case DungeonDiscoveryKindV2.RefractorCache:
                case DungeonDiscoveryKindV2.ZennyCache:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    identifiedScrap = discovery.CompletionSignificance;
                    effectKind = DungeonDiscoveryEffectKindV2.IdentifiedScrap;
                    break;

                case DungeonDiscoveryKindV2.FixedChipBlueprint:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    recipes.Add(rewardId);
                    effectKind = DungeonDiscoveryEffectKindV2.RecipeBlueprint;
                    break;

                case DungeonDiscoveryKindV2.Lore:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    permanentFacts.Add("lore:" + rewardId);
                    effectKind = DungeonDiscoveryEffectKindV2.LoreFact;
                    break;

                case DungeonDiscoveryKindV2.Shortcut:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    effectKind = DungeonDiscoveryEffectKindV2.Shortcut;
                    break;

                case DungeonDiscoveryKindV2.Landmark:
                    landmarks.Add(discovery.LocationAnchorId);
                    effectKind = DungeonDiscoveryEffectKindV2.Landmark;
                    break;

                case DungeonDiscoveryKindV2.MechanismKnowledge:
                    if (!RequireRewardId(discovery, out failureCode, out message)) return false;
                    requiredItems.Add(rewardId);
                    if (anchor.Kind == DungeonAnchorKindV2.Console
                        && !string.IsNullOrWhiteSpace(anchor.ProfileId)
                        && plan.EnvironmentControllers.Any(value =>
                            string.Equals(value.Id, anchor.ProfileId, StringComparison.Ordinal)))
                    {
                        // Map knowledge is keyed by the environment
                        // controller's stable ID. A credential/key pickup may
                        // use MechanismKnowledge for its typed item grant, but
                        // its reward anchor is not itself a mechanism.
                        mechanisms.Add(anchor.ProfileId);
                    }
                    effectKind = DungeonDiscoveryEffectKindV2.MechanismCredential;
                    break;

                default:
                    return Fail(
                        "unsupported-discovery-kind",
                        "The V2 discovery kind has no typed campaign mapping.",
                        out failureCode,
                        out message);
            }

            var grant = new DungeonRewardGrantV1(
                identifiedScrap: identifiedScrap,
                requiredItemIds: requiredItems,
                permanentFactIds: permanentFacts,
                currentExpeditionShortcutIds: currentExpeditionShortcuts,
                discoveredRecipeIds: recipes,
                seenRegionIds: new[] { anchor.RegionId },
                visitedRegionIds: new[] { anchor.RegionId },
                knownLandmarkIds: landmarks,
                knownMechanismIds: mechanisms);
            var request = new DungeonRewardClaimRequestV1(
                expedition.ruinId,
                discovery.Id,
                expedition.expeditionId,
                scope,
                grant);
            DungeonRewardClaimRequestV1 activationRequest =
                discovery.Kind == DungeonDiscoveryKindV2.Shortcut
                    ? new DungeonRewardClaimRequestV1(
                        expedition.ruinId,
                        discovery.Id + ShortcutActivationClaimSuffix,
                        expedition.expeditionId,
                        DungeonRewardClaimScopeV1.OncePerExpedition,
                        new DungeonRewardGrantV1(
                            currentExpeditionShortcutIds: new[] { rewardId }))
                    : null;
            command = new DungeonDiscoveryCommandV2(
                discovery,
                effectKind,
                request,
                activationRequest,
                recovery);
            return true;
        }

        private static UnidentifiedRecoveryV1 BuildKnownFieldRecovery(
            string ruinId,
            DungeonDiscoveryPlanV2 discovery,
            string rewardId)
        {
            string name;
            string aspect;
            if (string.Equals(
                    rewardId,
                    IndustrialFactoryV2Ruleset.CoolingFinArrayRewardId,
                    StringComparison.Ordinal))
            {
                name = "Cooling Fin Array";
                aspect = "cooling";
            }
            else if (string.Equals(
                         rewardId,
                         IndustrialFactoryV2Ruleset.AncientBatteryPackRewardId,
                         StringComparison.Ordinal))
            {
                name = "Ancient Battery Pack";
                aspect = "energy";
            }
            else
            {
                return null;
            }

            string recoveryId = "dungeon-recovery:"
                + DungeonRewardTransactionService.CreateClaimKey(ruinId, discovery.Id);
            return new UnidentifiedRecoveryV1
            {
                recoveryId = recoveryId,
                sourceKind = "dungeon-discovery",
                sourceId = discovery.Id,
                sequence = DungeonDeterministicRandom.HashSeed(recoveryId),
                quantity = 1,
                recoverableParts = new List<RecoveryPartV1>
                {
                    new RecoveryPartV1
                    {
                        materialId = rewardId,
                        name = name,
                        family = "Reaverbot Part",
                        aspect = aspect,
                        tier = "specialized",
                        quantity = 1
                    }
                }
            };
        }

        private static bool RequireRewardId(
            DungeonDiscoveryPlanV2 discovery,
            out string failureCode,
            out string message)
        {
            if (!string.IsNullOrWhiteSpace(discovery.DurableRewardId))
            {
                failureCode = null;
                message = null;
                return true;
            }

            return Fail(
                "missing-durable-reward",
                "This discovery kind requires a durable reward id.",
                out failureCode,
                out message);
        }

        private static bool Fail(
            string code,
            string details,
            out string failureCode,
            out string message)
        {
            failureCode = code;
            message = details;
            return false;
        }
    }

    public sealed class DungeonCampaignCommitResultV2
    {
        private DungeonCampaignCommitResultV2(bool success, CampaignStateV1 state, string message)
        {
            Success = success;
            State = state;
            Message = message;
        }

        public bool Success { get; }
        public CampaignStateV1 State { get; }
        public string Message { get; }

        public static DungeonCampaignCommitResultV2 Succeeded(CampaignStateV1 state)
        {
            return new DungeonCampaignCommitResultV2(
                true,
                state ?? throw new ArgumentNullException(nameof(state)),
                null);
        }

        public static DungeonCampaignCommitResultV2 Failed(string message)
        {
            return new DungeonCampaignCommitResultV2(
                false,
                null,
                string.IsNullOrWhiteSpace(message) ? "Campaign commit failed." : message.Trim());
        }
    }

    public interface IDungeonCampaignProgressionPortV2
    {
        CampaignStateV1 Snapshot { get; }
        DungeonCampaignCommitResultV2 Commit(string operation, CampaignStateV1 state);
    }

    public sealed class CampaignSessionDungeonProgressionPortV2 : IDungeonCampaignProgressionPortV2
    {
        private readonly CampaignSession session;

        public CampaignSessionDungeonProgressionPortV2(CampaignSession session)
        {
            this.session = session ?? throw new ArgumentNullException(nameof(session));
        }

        public CampaignStateV1 Snapshot => session.Snapshot;

        public DungeonCampaignCommitResultV2 Commit(string operation, CampaignStateV1 state)
        {
            CampaignCommitResult<CampaignStateV1> result = session.Commit(operation, state);
            return result.Success
                ? DungeonCampaignCommitResultV2.Succeeded(result.Envelope.State.Clone())
                : DungeonCampaignCommitResultV2.Failed(result.Message);
        }
    }

    public sealed class DungeonProgressionOperationResultV2
    {
        private DungeonProgressionOperationResultV2(
            bool success,
            bool changed,
            bool idempotentReplay,
            string failureCode,
            string message,
            string discoveryId,
            string claimKey,
            CampaignStateV1 state,
            DungeonDiscoveryCommandV2 command)
        {
            Success = success;
            Changed = changed;
            IdempotentReplay = idempotentReplay;
            FailureCode = failureCode;
            Message = message;
            DiscoveryId = discoveryId;
            ClaimKey = claimKey;
            State = state;
            Command = command;
        }

        public bool Success { get; }
        public bool Changed { get; }
        public bool IdempotentReplay { get; }
        public string FailureCode { get; }
        public string Message { get; }
        public string DiscoveryId { get; }
        public string ClaimKey { get; }
        public CampaignStateV1 State { get; }
        public DungeonDiscoveryCommandV2 Command { get; }

        internal static DungeonProgressionOperationResultV2 Succeeded(
            string discoveryId,
            string claimKey,
            CampaignStateV1 state,
            DungeonDiscoveryCommandV2 command,
            bool changed,
            bool idempotentReplay)
        {
            return new DungeonProgressionOperationResultV2(
                true,
                changed,
                idempotentReplay,
                null,
                null,
                discoveryId,
                claimKey,
                state,
                command);
        }

        internal static DungeonProgressionOperationResultV2 Failed(
            CampaignStateV1 source,
            string failureCode,
            string message,
            string discoveryId = null,
            string claimKey = null,
            DungeonDiscoveryCommandV2 command = null)
        {
            return new DungeonProgressionOperationResultV2(
                false,
                false,
                false,
                failureCode,
                message,
                discoveryId,
                claimKey,
                source,
                command);
        }
    }

    public enum DungeonExtractionStateV2
    {
        Inactive,
        RefractorRequired,
        Ready,
        RequestIssued
    }

    public sealed class DungeonExtractionRequestV2
    {
        internal DungeonExtractionRequestV2(
            string expeditionId,
            string ruinId,
            string dungeonPlanId,
            string extractionRegionId)
        {
            ExpeditionId = expeditionId;
            RuinId = ruinId;
            DungeonPlanId = dungeonPlanId;
            ExtractionRegionId = extractionRegionId;
        }

        public string ExpeditionId { get; }
        public string RuinId { get; }
        public string DungeonPlanId { get; }
        public string ExtractionRegionId { get; }
    }

    public sealed class DungeonExtractionAttemptResultV2
    {
        private DungeonExtractionAttemptResultV2(
            bool success,
            bool changed,
            bool idempotentReplay,
            string failureCode,
            string message,
            DungeonExtractionRequestV2 request)
        {
            Success = success;
            Changed = changed;
            IdempotentReplay = idempotentReplay;
            FailureCode = failureCode;
            Message = message;
            Request = request;
        }

        public bool Success { get; }
        public bool Changed { get; }
        public bool IdempotentReplay { get; }
        public string FailureCode { get; }
        public string Message { get; }
        public DungeonExtractionRequestV2 Request { get; }

        internal static DungeonExtractionAttemptResultV2 Succeeded(
            DungeonExtractionRequestV2 request,
            bool changed,
            bool replay)
        {
            return new DungeonExtractionAttemptResultV2(
                true,
                changed,
                replay,
                null,
                null,
                request);
        }

        internal static DungeonExtractionAttemptResultV2 Failed(string code, string message)
        {
            return new DungeonExtractionAttemptResultV2(
                false,
                false,
                false,
                code,
                message,
                null);
        }
    }

    /// <summary>
    /// Bounded campaign-facing progression coordinator. It never owns scene
    /// objects and therefore survives scene re-entry through durable claim and
    /// refractor state rather than through MonoBehaviour lifetime.
    /// </summary>
    public sealed class DungeonExpeditionProgressionCoordinatorV2
    {
        private readonly DungeonPlanV2 plan;
        private readonly IDungeonCampaignProgressionPortV2 campaign;
        private bool extractionRequestIssued;
        private DungeonExtractionRequestV2 issuedExtractionRequest;

        public DungeonExpeditionProgressionCoordinatorV2(
            DungeonPlanV2 plan,
            IDungeonCampaignProgressionPortV2 campaign)
        {
            this.plan = plan ?? throw new ArgumentNullException(nameof(plan));
            this.campaign = campaign ?? throw new ArgumentNullException(nameof(campaign));
        }

        public event Action<DungeonExtractionRequestV2> ExtractionRequested;

        public DungeonPlanV2 Plan => plan;
        public string LargeRefractorDiscoveryId => "large-refractor:" + plan.DeterministicSignature;
        public string FinalGuardianDiscoveryId => "final-guardian:" + plan.DeterministicSignature;

        public bool IsFinalGuardianDefeated
        {
            get
            {
                CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
                return ValidateContext(state) == null
                    && (Contains(
                            state.expedition.dungeonProgress.requiredFactIds,
                            IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId)
                        || state.expedition.dungeonProgress.refractorSecured);
            }
        }

        public DungeonExtractionStateV2 ExtractionState
        {
            get
            {
                CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
                if (ValidateContext(state) != null)
                {
                    return DungeonExtractionStateV2.Inactive;
                }

                if (extractionRequestIssued)
                {
                    return DungeonExtractionStateV2.RequestIssued;
                }

                return state.expedition.dungeonProgress.refractorSecured
                    ? DungeonExtractionStateV2.Ready
                    : DungeonExtractionStateV2.RefractorRequired;
            }
        }

        public DungeonProgressionOperationResultV2 TryDiscover(
            string discoveryId,
            DungeonPredicateStateV2 predicateState = null)
        {
            CampaignStateV1 source = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            string contextFailure = ValidateContext(source);
            if (contextFailure != null)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "expedition-context-mismatch",
                    contextFailure,
                    discoveryId);
            }

            DungeonDiscoveryPlanV2 discovery = plan.Discoveries.FirstOrDefault(value =>
                string.Equals(value.Id, discoveryId, StringComparison.Ordinal));
            if (discovery == null)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "unknown-discovery",
                    "The discovery is not part of the active dungeon plan.",
                    discoveryId);
            }

            if (predicateState != null
                && !DungeonPredicateEvaluatorV2.Evaluate(discovery.AccessPredicate, predicateState))
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "discovery-locked",
                    "The discovery access predicate is not currently satisfied.",
                    discovery.Id);
            }

            if (!DungeonDiscoveryCommandMapperV2.TryMap(
                    plan,
                    discovery,
                    source,
                    out DungeonDiscoveryCommandV2 command,
                    out string failureCode,
                    out string message))
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    failureCode,
                    message,
                    discovery.Id);
            }

            DungeonRewardTransactionResult transaction =
                DungeonRewardTransactionService.ClaimDiscovery(source, command.RewardRequest);
            if (!transaction.Success)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    transaction.FailureCode,
                    transaction.Message,
                    discovery.Id,
                    transaction.ClaimKey,
                    command);
            }

            CampaignStateV1 committedState = transaction.State;
            DungeonRewardTransactionResult activationTransaction = null;
            if (command.CurrentExpeditionActivationRequest != null)
            {
                activationTransaction = DungeonRewardTransactionService.ClaimDiscovery(
                    committedState,
                    command.CurrentExpeditionActivationRequest);
                if (!activationTransaction.Success)
                {
                    return DungeonProgressionOperationResultV2.Failed(
                        source,
                        activationTransaction.FailureCode,
                        activationTransaction.Message,
                        discovery.Id,
                        activationTransaction.ClaimKey,
                        command);
                }

                committedState = activationTransaction.State;
            }

            bool changed = transaction.Changed || activationTransaction?.Changed == true;
            bool idempotentReplay = transaction.IdempotentReplay
                && (activationTransaction == null || activationTransaction.IdempotentReplay);
            if (changed)
            {
                if (transaction.Changed)
                {
                    command.ApplySupplementalEffects(committedState);
                }
                committedState = CampaignStateRepair.Repair(committedState);
                DungeonCampaignCommitResultV2 commit = campaign.Commit(
                    "dungeon-discovery:" + transaction.ClaimKey,
                    committedState);
                if (!commit.Success)
                {
                    return DungeonProgressionOperationResultV2.Failed(
                        source,
                        "save-failed",
                        commit.Message,
                        discovery.Id,
                        transaction.ClaimKey,
                        command);
                }

                committedState = commit.State;
            }

            return DungeonProgressionOperationResultV2.Succeeded(
                discovery.Id,
                transaction.ClaimKey,
                committedState,
                command,
                changed,
                idempotentReplay);
        }

        public DungeonProgressionOperationResultV2 TrySecureLargeRefractor(string resolvedAtUtc)
        {
            CampaignStateV1 source = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            string contextFailure = ValidateContext(source);
            if (contextFailure != null)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "expedition-context-mismatch",
                    contextFailure,
                    LargeRefractorDiscoveryId);
            }

            if (string.IsNullOrWhiteSpace(resolvedAtUtc))
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "invalid-refractor-resolution",
                    "A stable resolution timestamp is required.",
                    LargeRefractorDiscoveryId);
            }

            if (!source.expedition.dungeonProgress.refractorSecured
                && !Contains(
                    source.expedition.dungeonProgress.requiredFactIds,
                    IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId))
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "final-guardian-required",
                    "The machine-core guardian must be defeated before the Large Refractor can be secured.",
                    LargeRefractorDiscoveryId);
            }

            string resolutionId = "large-refractor-resolution:"
                + source.expedition.expeditionId + ":" + plan.DeterministicSignature;
            DungeonRewardTransactionResult transaction =
                DungeonRewardTransactionService.ResolveLargeRefractor(
                    source,
                    resolutionId,
                    source.expedition.ruinId,
                    LargeRefractorDiscoveryId,
                    source.expedition.expeditionId,
                    resolvedAtUtc);
            if (!transaction.Success)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    transaction.FailureCode,
                    transaction.Message,
                    LargeRefractorDiscoveryId,
                    transaction.ClaimKey);
            }

            CampaignStateV1 committedState = transaction.State;
            if (transaction.Changed)
            {
                DungeonCampaignCommitResultV2 commit = campaign.Commit(
                    "secure-large-refractor:" + transaction.ClaimKey,
                    committedState);
                if (!commit.Success)
                {
                    return DungeonProgressionOperationResultV2.Failed(
                        source,
                        "save-failed",
                        commit.Message,
                        LargeRefractorDiscoveryId,
                        transaction.ClaimKey);
                }

                committedState = commit.State;
            }

            return DungeonProgressionOperationResultV2.Succeeded(
                LargeRefractorDiscoveryId,
                transaction.ClaimKey,
                committedState,
                null,
                transaction.Changed,
                transaction.IdempotentReplay);
        }

        public DungeonProgressionOperationResultV2 TryMarkFinalGuardianDefeated()
        {
            CampaignStateV1 source = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            string contextFailure = ValidateContext(source);
            if (contextFailure != null)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    "expedition-context-mismatch",
                    contextFailure,
                    FinalGuardianDiscoveryId);
            }

            var request = new DungeonRewardClaimRequestV1(
                source.expedition.ruinId,
                FinalGuardianDiscoveryId,
                source.expedition.expeditionId,
                DungeonRewardClaimScopeV1.OncePerExpedition,
                new DungeonRewardGrantV1(requiredFactIds: new[]
                {
                    IndustrialFactoryV2Ruleset.FinalEliteDefeatedFactId
                }));
            DungeonRewardTransactionResult transaction =
                DungeonRewardTransactionService.ClaimDiscovery(source, request);
            if (!transaction.Success)
            {
                return DungeonProgressionOperationResultV2.Failed(
                    source,
                    transaction.FailureCode,
                    transaction.Message,
                    FinalGuardianDiscoveryId,
                    transaction.ClaimKey);
            }

            CampaignStateV1 committedState = transaction.State;
            if (transaction.Changed)
            {
                DungeonCampaignCommitResultV2 commit = campaign.Commit(
                    "defeat-final-guardian:" + transaction.ClaimKey,
                    committedState);
                if (!commit.Success)
                {
                    return DungeonProgressionOperationResultV2.Failed(
                        source,
                        "save-failed",
                        commit.Message,
                        FinalGuardianDiscoveryId,
                        transaction.ClaimKey);
                }

                committedState = commit.State;
            }

            return DungeonProgressionOperationResultV2.Succeeded(
                FinalGuardianDiscoveryId,
                transaction.ClaimKey,
                committedState,
                null,
                transaction.Changed,
                transaction.IdempotentReplay);
        }

        public bool IsDiscoveryClaimed(string discoveryId)
        {
            DungeonDiscoveryPlanV2 discovery = plan.Discoveries.FirstOrDefault(value =>
                string.Equals(value.Id, discoveryId, StringComparison.Ordinal));
            CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            if (discovery == null || ValidateContext(state) != null
                || discovery.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.Repeatable)
            {
                return false;
            }

            if (discovery.DuplicatePolicy == DungeonDiscoveryDuplicatePolicyV2.OncePerExpedition)
            {
                string expeditionClaimKey = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                    state.expedition.expeditionId,
                    state.expedition.ruinId,
                    discovery.Id);
                return Contains(
                    state.expedition.dungeonProgress.claimedRewardIds,
                    expeditionClaimKey);
            }

            string claimKey = DungeonRewardTransactionService.CreateClaimKey(
                state.expedition.ruinId,
                discovery.Id);
            KnownRuinV1 ruin = state.knownRuins.FirstOrDefault(value => value != null
                && string.Equals(value.ruinId, state.expedition.ruinId, StringComparison.Ordinal));
            return ruin != null && Contains(ruin.claimedRewardIds, claimKey);
        }

        public bool IsCurrentExpeditionShortcutActivationClaimed(string discoveryId)
        {
            DungeonDiscoveryPlanV2 discovery = plan.Discoveries.FirstOrDefault(value =>
                string.Equals(value.Id, discoveryId, StringComparison.Ordinal));
            CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            if (discovery == null
                || discovery.Kind != DungeonDiscoveryKindV2.Shortcut
                || ValidateContext(state) != null)
            {
                return false;
            }

            string claimKey = DungeonRewardTransactionService.CreateExpeditionClaimKey(
                state.expedition.expeditionId,
                state.expedition.ruinId,
                discovery.Id + DungeonDiscoveryCommandMapperV2.ShortcutActivationClaimSuffix);
            return Contains(state.expedition.dungeonProgress.claimedRewardIds, claimKey);
        }

        public DungeonExtractionAttemptResultV2 TryRequestExtraction()
        {
            CampaignStateV1 state = CampaignStateRepair.Repair(campaign.Snapshot?.Clone());
            string contextFailure = ValidateContext(state);
            if (contextFailure != null)
            {
                return DungeonExtractionAttemptResultV2.Failed(
                    "expedition-context-mismatch",
                    contextFailure);
            }

            if (!state.expedition.dungeonProgress.refractorSecured)
            {
                return DungeonExtractionAttemptResultV2.Failed(
                    "large-refractor-required",
                    "The Large Refractor must be secured before extraction.");
            }

            if (extractionRequestIssued)
            {
                return DungeonExtractionAttemptResultV2.Succeeded(
                    issuedExtractionRequest,
                    changed: false,
                    replay: true);
            }

            issuedExtractionRequest = new DungeonExtractionRequestV2(
                state.expedition.expeditionId,
                state.expedition.ruinId,
                plan.DeterministicSignature,
                plan.ExtractionRegionId);
            extractionRequestIssued = true;
            ExtractionRequested?.Invoke(issuedExtractionRequest);
            return DungeonExtractionAttemptResultV2.Succeeded(
                issuedExtractionRequest,
                changed: true,
                replay: false);
        }

        private string ValidateContext(CampaignStateV1 state)
        {
            if (state?.expedition == null
                || string.IsNullOrWhiteSpace(state.expedition.expeditionId)
                || string.IsNullOrWhiteSpace(state.expedition.ruinId))
            {
                return "There is no active durable dungeon expedition.";
            }

            if (!string.Equals(state.expedition.dungeonPlanId, plan.DeterministicSignature, StringComparison.Ordinal)
                || !string.Equals(state.expedition.dungeonProfileId, plan.ProfileId, StringComparison.Ordinal)
                || !string.Equals(state.expedition.dungeonRulesetVersion, plan.RulesetVersion, StringComparison.Ordinal)
                || !string.Equals(state.expedition.runSeed, plan.Seed, StringComparison.Ordinal)
                || !string.Equals(
                    state.expedition.ruinId,
                    "ruin:" + plan.DeterministicSignature,
                    StringComparison.Ordinal)
                || !string.Equals(
                    state.expedition.dungeonContentPackVersion,
                    plan.ContentPackVersion,
                    StringComparison.Ordinal))
            {
                return "The durable expedition plan, profile, ruleset, seed, canonical ruin, or content-pack identity "
                    + "does not match the active DungeonPlanV2.";
            }

            return null;
        }

        private static bool Contains(List<string> values, string value)
        {
            return values != null && values.Any(item => string.Equals(item, value, StringComparison.Ordinal));
        }
    }
}
