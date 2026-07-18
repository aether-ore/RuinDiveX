using System;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RuinCrawler.Runtime.Persistence
{
    [DefaultExecutionOrder(-800)]
    public sealed class ExpeditionFlowController : MonoBehaviour
    {
        public const string IndustrialFactoryV2ProfileId = "industrial-factory-v2";
        public const string IndustrialFactoryV2RulesetVersion = IndustrialFactoryV2Ruleset.RulesetVersion;
        public const string IndustrialFactoryV2ContentPackVersion = IndustrialFactoryV2Ruleset.ContentPackVersion;
        public const int IndustrialFactoryV2StandardDifficulty = 1;
        public const int IndustrialFactoryV2BossHuntDifficulty = 3;
        [SerializeField] private CampaignSession campaignSession;
        [SerializeField] private string campScene = "Camp";
        [SerializeField] private string expeditionScene = "Expedition";
        [SerializeField] private string testRangeScene = "TestRange";

        public static ExpeditionFlowController Instance { get; private set; }

        public bool HasActiveExpedition
        {
            get
            {
                campaignSession ??= CampaignSession.Instance;
                return campaignSession != null
                       && !string.IsNullOrWhiteSpace(
                           campaignSession.Snapshot.bossHunts?.activeExpeditionId);
            }
        }

        public bool CanResumeActiveExpedition
        {
            get
            {
                campaignSession ??= CampaignSession.Instance;
                return campaignSession != null
                       && IsResumable(campaignSession.Snapshot, out _);
            }
        }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            campaignSession ??= CampaignSession.Instance;
            DontDestroyOnLoad(gameObject);
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        public bool BeginExpedition(string runSeed = null)
        {
            campaignSession ??= CampaignSession.Instance;
            if (campaignSession == null)
            {
                return false;
            }

            string seed = string.IsNullOrWhiteSpace(runSeed)
                ? DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")
                : runSeed.Trim();
            string expeditionId = "expedition-" + Guid.NewGuid().ToString("N");
            WorkshopTransactionResult planned = CreateBeginExpeditionTransaction(
                campaignSession.Snapshot,
                expeditionId,
                seed);
            if (!planned.Success)
            {
                Debug.LogWarning("[RuinCrawler Expedition] " + (planned.Message ?? planned.FailureCode));
                return false;
            }

            CampaignCommitResult<CampaignStateV1> commit = campaignSession.Commit("begin-expedition", planned.State);
            if (!commit.Success)
            {
                return false;
            }

            SceneManager.LoadScene(expeditionScene);
            return true;
        }

        /// <summary>
        /// Camp's single entrance contract. A fresh campaign begins a new
        /// expedition; a reloaded or defeated campaign re-enters the already
        /// committed expedition without changing its ID, seed, Boss Hunt, or
        /// reward ledgers.
        /// </summary>
        public bool EnterOrResumeExpedition(string runSeed = null)
        {
            if (!HasActiveExpedition)
            {
                return BeginExpedition(runSeed);
            }

            if (CanResumeActiveExpedition)
            {
                return ResumeActiveExpedition();
            }

            // V2 is the sole expedition format. A stale, incomplete, or
            // non-V2 active record must never strand the player in Camp.
            // Abandon only that active run, preserving Boss Hunt selection and
            // all durable campaign ownership, then commit a fresh V2 ruin.
            return AbandonActiveExpedition() && BeginExpedition(runSeed);
        }

        /// <summary>
        /// The V2 plan signature includes difficulty, so departure and scene
        /// reconstruction must resolve it from the same durable Boss Hunt fact.
        /// </summary>
        public static int ResolveIndustrialFactoryV2GenerationDifficulty(CampaignStateV1 source)
        {
            bool selectedBossHunt = !string.IsNullOrWhiteSpace(
                source?.bossHunts?.selectedProfileId);
            bool activeBossHunt = !string.IsNullOrWhiteSpace(
                source?.expedition?.bossProfileId);
            return selectedBossHunt || activeBossHunt
                ? IndustrialFactoryV2BossHuntDifficulty
                : IndustrialFactoryV2StandardDifficulty;
        }

        /// <summary>
        /// Pure transaction seam used by BeginExpedition and Edit Mode entry
        /// tests. It pins the complete V2 identity before any scene build can
        /// occur, so runtime reconstruction never repairs or rewrites the save.
        /// </summary>
        public static WorkshopTransactionResult CreateBeginExpeditionTransaction(
            CampaignStateV1 source,
            string expeditionId,
            string runSeed)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            DungeonPlanV2 plan;
            IndustrialFactoryV2GenerationResult generation;
            try
            {
                generation = new IndustrialFactoryV2Generator().GenerateResult(
                    runSeed,
                    new IndustrialFactoryV2GenerationOptions(
                        ResolveIndustrialFactoryV2GenerationDifficulty(source)));
            }
            catch (Exception exception)
            {
                return WorkshopTransactionResult.Failed(
                    source,
                    "dungeon-generation-failed",
                    "industrial-factory-v2 generation failed before scene build: "
                        + exception.Message);
            }

            if (!generation.Succeeded)
            {
                string details = generation.Failure == null
                    ? "No structured generation failure was returned."
                    : string.Join(" | ", generation.Failure.LastErrors);
                return WorkshopTransactionResult.Failed(
                    source,
                    "dungeon-generation-failed",
                    "industrial-factory-v2 exhausted its deterministic attempts before scene build: "
                        + details);
            }

            plan = generation.Plan;

            return RollWorkshopService.BeginExpedition(
                source,
                expeditionId,
                runSeed,
                IndustrialFactoryV2ProfileId,
                plan.RulesetVersion,
                dungeonPlanId: plan.DeterministicSignature,
                ruinId: "ruin:" + plan.DeterministicSignature,
                dungeonContentPackVersion: plan.ContentPackVersion);
        }

        public bool ResumeActiveExpedition()
        {
            campaignSession ??= CampaignSession.Instance;
            if (campaignSession == null)
            {
                return false;
            }

            CampaignStateV1 state = campaignSession.Snapshot;
            if (!IsResumable(state, out string reason))
            {
                Debug.LogWarning(
                    "[RuinCrawler Expedition] The saved expedition cannot be resumed: "
                    + reason
                    + " Abandon it from Roll's EXPEDITIONS screen to start another run.");
                return false;
            }

            SceneManager.LoadScene(expeditionScene);
            return true;
        }

        /// <summary>
        /// Explicitly gives up the active run. This is intentionally separate
        /// from re-entry so a reload or defeat cannot silently discard a seed,
        /// Boss Hunt selection, collected salvage, or reward transaction.
        /// </summary>
        public bool AbandonActiveExpedition()
        {
            campaignSession ??= CampaignSession.Instance;
            if (campaignSession == null)
            {
                return false;
            }

            WorkshopTransactionResult result = campaignSession.AbandonActiveExpedition();
            if (!result.Success)
            {
                Debug.LogWarning(
                    "[RuinCrawler Expedition] " + (result.Message ?? result.FailureCode));
            }

            return result.Success;
        }

        public bool ReturnToCamp()
        {
            campaignSession ??= CampaignSession.Instance;
            if (campaignSession == null)
            {
                return false;
            }

            CampaignStateV1 state = campaignSession.Snapshot;
            if (!string.IsNullOrEmpty(state.bossHunts.activeExpeditionId))
            {
                if (!AbandonActiveExpedition())
                {
                    return false;
                }
            }

            SceneManager.LoadScene(campScene);
            return true;
        }

        /// <summary>
        /// Defeat returns control to Camp but deliberately preserves the active
        /// expedition. The Support Car and Roll can then resume the exact same
        /// deterministic run, or the player may explicitly abandon it.
        /// </summary>
        public bool ReturnToCampAfterDefeat()
        {
            SceneManager.LoadScene(campScene);
            return true;
        }

        public void LaunchTestRange()
        {
            SceneManager.LoadScene(testRangeScene);
        }

        private static bool IsResumable(CampaignStateV1 state, out string reason)
        {
            string activeId = state?.bossHunts?.activeExpeditionId;
            if (string.IsNullOrWhiteSpace(activeId))
            {
                reason = "there is no active expedition ID.";
                return false;
            }

            if (state.expedition == null)
            {
                reason = "the expedition source record is missing.";
                return false;
            }

            if (!string.Equals(
                    activeId,
                    state.expedition.expeditionId,
                    StringComparison.Ordinal))
            {
                reason = "the active and source expedition IDs do not match.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(state.expedition.runSeed))
            {
                reason = "the run seed is missing.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(state.expedition.dungeonProfileId))
            {
                reason = "the dungeon profile is missing.";
                return false;
            }

            if (!string.Equals(
                    state.expedition.dungeonProfileId,
                    IndustrialFactoryV2ProfileId,
                    StringComparison.Ordinal))
            {
                reason = "the active expedition uses a different dungeon profile.";
                return false;
            }

            if (!string.Equals(
                    state.expedition.dungeonRulesetVersion,
                    IndustrialFactoryV2RulesetVersion,
                    StringComparison.Ordinal))
            {
                reason = "the active expedition uses a different dungeon ruleset.";
                return false;
            }

            if (!string.Equals(
                    state.expedition.dungeonContentPackVersion,
                    IndustrialFactoryV2ContentPackVersion,
                    StringComparison.Ordinal))
            {
                reason = "the active expedition uses a different dungeon content pack.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(state.expedition.dungeonPlanId)
                || string.IsNullOrWhiteSpace(state.expedition.ruinId))
            {
                reason = "the active expedition is missing its generated plan identity.";
                return false;
            }

            reason = null;
            return true;
        }
    }
}
