using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Combat;
using UnityEngine;

namespace RuinCrawler.Runtime.BossHunts
{
    public enum BossPhaseState
    {
        PhaseOne,
        PhaseTransition,
        PhaseTwo,
        Defeated,
        Resolved,
        Cleaned,
    }

    public sealed class BossHealthEvent
    {
        internal BossHealthEvent(
            string profileId,
            string stableBossId,
            BossPhaseState phase,
            HealthSnapshot previous,
            HealthSnapshot current)
        {
            ProfileId = profileId;
            StableBossId = stableBossId;
            Phase = phase;
            Previous = previous;
            Current = current;
        }
        public string ProfileId { get; }
        public string StableBossId { get; }
        public BossPhaseState Phase { get; }
        public HealthSnapshot Previous { get; }
        public HealthSnapshot Current { get; }
        public double Delta => Current.Current - Previous.Current;
    }

    public sealed class BossPhaseChangedEvent
    {
        internal BossPhaseChangedEvent(
            string profileId,
            string stableBossId,
            BossPhaseState previous,
            BossPhaseState current,
            double normalizedHealth)
        {
            ProfileId = profileId;
            StableBossId = stableBossId;
            Previous = previous;
            Current = current;
            NormalizedHealth = normalizedHealth;
        }
        public string ProfileId { get; }
        public string StableBossId { get; }
        public BossPhaseState Previous { get; }
        public BossPhaseState Current { get; }
        public double NormalizedHealth { get; }
    }

    public sealed class BossDefeatedEvent
    {
        internal BossDefeatedEvent(string profileId, string stableBossId, BossVictoryPlan victory, HealthSnapshot health)
        {
            ProfileId = profileId;
            StableBossId = stableBossId;
            Victory = victory;
            Health = health;
        }
        public string ProfileId { get; }
        public string StableBossId { get; }
        public BossVictoryPlan Victory { get; }
        public HealthSnapshot Health { get; }
    }

    public sealed class BossVictoryResolution
    {
        internal BossVictoryResolution(BossVictoryPlan plan, WorkshopTransactionResult transaction)
        {
            Plan = plan;
            Transaction = transaction;
        }
        public BossVictoryPlan Plan { get; }
        public WorkshopTransactionResult Transaction { get; }
    }

    /// <summary>
    /// Typed phase and victory boundary around a generated or authored boss.
    /// It never writes campaign state itself: Resolve returns the exact pure
    /// Roll transaction for the caller to commit atomically through its save
    /// service, and AcknowledgeCommittedResolution advances presentation only
    /// after that durable state is supplied. Threshold-crossing damage and
    /// further damage during the transition are intentionally preserved; no
    /// phase-overflow damage is silently discarded.
    /// </summary>
    public sealed class BossHuntRuntimeController : MonoBehaviour
    {
        private BossHuntSpawnPlan plan;
        private BossSpawnProduct product;
        private HealthSnapshot lastHealth;
        private float transitionRemaining;
        private bool initialized;
        private bool resolutionEventRaised;

        public event Action<BossHealthEvent> HealthChanged;
        public event Action<BossPhaseChangedEvent> PhaseChanged;
        public event Action<BossDefeatedEvent> Defeated;
        public event Action<BossVictoryResolution> VictoryResolved;

        public BossHuntSpawnPlan Plan => plan;
        public BossSpawnProduct Product => product;
        public HealthSnapshot Health => product?.Health != null ? product.Health.Snapshot : default;
        public BossPhaseState Phase { get; private set; } = BossPhaseState.Cleaned;
        public bool IsDefeated => Phase == BossPhaseState.Defeated || Phase == BossPhaseState.Resolved;
        public bool IsResolved => Phase == BossPhaseState.Resolved;

        internal void Initialize(BossHuntSpawnPlan sourcePlan, BossSpawnProduct sourceProduct)
        {
            if (initialized) throw new InvalidOperationException("Boss Hunt runtime is already initialized.");
            plan = sourcePlan ?? throw new ArgumentNullException(nameof(sourcePlan));
            product = sourceProduct ?? throw new ArgumentNullException(nameof(sourceProduct));
            lastHealth = product.Health.Snapshot;
            Phase = BossPhaseState.PhaseOne;
            transitionRemaining = 0f;
            initialized = true;
            product.Health.HealthChanged += HandleHealthChanged;
            product.Health.Died += HandleDied;
        }

        public void Tick(float deltaTime)
        {
            if (!initialized || Phase != BossPhaseState.PhaseTransition || deltaTime <= 0f) return;
            transitionRemaining = Mathf.Max(0f, transitionRemaining - deltaTime);
            if (transitionRemaining > 0f) return;

            if (product.GeneratedRuntime != null)
            {
                product.GeneratedRuntime.enabled = true;
            }
            ChangePhase(BossPhaseState.PhaseTwo, product.Health.Snapshot.Normalized);
        }

        public BossVictoryResolution Resolve(CampaignStateV1 campaign, string committedAtUtc)
        {
            if (!IsDefeated)
            {
                return new BossVictoryResolution(
                    plan?.Victory,
                    WorkshopTransactionResult.Failed(
                        campaign,
                        "boss-not-defeated",
                        "Boss victory cannot resolve before the authoritative health state dies."));
            }

            WorkshopTransactionResult transaction = plan.Victory.Resolve(campaign, committedAtUtc);
            return new BossVictoryResolution(plan.Victory, transaction);
        }

        public bool AcknowledgeCommittedResolution(
            BossVictoryResolution resolution,
            CampaignStateV1 committedCampaign)
        {
            if (!IsDefeated || resolution?.Plan == null || !resolution.Transaction.Success
                || committedCampaign?.bossHunts == null
                || !string.Equals(resolution.Plan.VictoryId, plan.Victory.VictoryId, StringComparison.Ordinal)
                || !Contains(committedCampaign.bossHunts.resolvedVictoryIds, plan.Victory.VictoryId)
                || committedCampaign.bossHunts.victoryHistory == null
                || !committedCampaign.bossHunts.victoryHistory.Exists(value => value != null
                    && string.Equals(value.victoryId, plan.Victory.VictoryId, StringComparison.Ordinal)
                    && string.Equals(value.profileId, plan.Profile.Id, StringComparison.Ordinal)
                    && string.Equals(value.expeditionId, plan.Victory.ExpeditionId, StringComparison.Ordinal)))
            {
                return false;
            }

            ChangePhase(BossPhaseState.Resolved, product.Health.Snapshot.Normalized);
            if (!resolutionEventRaised)
            {
                resolutionEventRaised = true;
                VictoryResolved?.Invoke(resolution);
            }
            return true;
        }

        internal void Shutdown()
        {
            if (!initialized) return;
            product.Health.HealthChanged -= HandleHealthChanged;
            product.Health.Died -= HandleDied;
            if (product.GeneratedRuntime != null)
            {
                product.GeneratedRuntime.enabled = true;
            }
            initialized = false;
            ChangePhase(BossPhaseState.Cleaned, product.Health.Snapshot.Normalized);
        }

        private void Update() => Tick(Time.deltaTime);
        private void OnDestroy() => Shutdown();

        private void HandleHealthChanged(HealthSnapshot current)
        {
            HealthSnapshot previous = lastHealth;
            lastHealth = current;
            HealthChanged?.Invoke(new BossHealthEvent(
                plan.Profile.Id,
                product.StableBossId,
                Phase,
                previous,
                current));

            if (Phase == BossPhaseState.PhaseOne && !current.IsDead
                && current.Normalized <= plan.Profile.PhaseThreshold)
            {
                transitionRemaining = (float)plan.Profile.PhaseTransitionSeconds;
                if (product.GeneratedRuntime != null)
                {
                    product.GeneratedRuntime.enabled = false;
                }
                ChangePhase(BossPhaseState.PhaseTransition, current.Normalized);
                if (transitionRemaining <= 0f) Tick(float.Epsilon);
            }
        }

        private void HandleDied(HealthSnapshot current)
        {
            if (Phase == BossPhaseState.Defeated || Phase == BossPhaseState.Resolved) return;
            ChangePhase(BossPhaseState.Defeated, current.Normalized);
            Defeated?.Invoke(new BossDefeatedEvent(
                plan.Profile.Id,
                product.StableBossId,
                plan.Victory,
                current));
        }

        private void ChangePhase(BossPhaseState next, double normalizedHealth)
        {
            if (Phase == next) return;
            BossPhaseState previous = Phase;
            Phase = next;
            PhaseChanged?.Invoke(new BossPhaseChangedEvent(
                plan?.Profile?.Id,
                product?.StableBossId,
                previous,
                next,
                normalizedHealth));
        }

        private static bool Contains(System.Collections.Generic.IEnumerable<string> values, string expected)
        {
            if (values == null) return false;
            foreach (string value in values)
            {
                if (string.Equals(value, expected, StringComparison.Ordinal)) return true;
            }
            return false;
        }
    }
}
