using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Campaign
{
    [Serializable]
    public sealed class WorkshopRecipeV1
    {
        public string recipeId;
        public string label;
        public string outputKind;
        public string outputId;
        public int identifiedScrapCost;
        public bool requiresDefenseUnlock;
        public bool repeatable;
        public List<WorkshopPartRequirementV1> parts = new List<WorkshopPartRequirementV1>();
    }

    [Serializable]
    public sealed class WorkshopPartRequirementV1
    {
        public string materialId;
        public int quantity = 1;
    }

    public sealed class WorkshopTransactionResult
    {
        private WorkshopTransactionResult(
            bool success,
            bool changed,
            bool idempotentReplay,
            string failureCode,
            string message,
            CampaignStateV1 state,
            int processedRecoveries = 0,
            int scrapStored = 0,
            int partsStored = 0)
        {
            Success = success;
            Changed = changed;
            IdempotentReplay = idempotentReplay;
            FailureCode = failureCode;
            Message = message;
            State = state;
            ProcessedRecoveries = processedRecoveries;
            ScrapStored = scrapStored;
            PartsStored = partsStored;
        }

        public bool Success { get; }
        public bool Changed { get; }
        public bool IdempotentReplay { get; }
        public string FailureCode { get; }
        public string Message { get; }
        public CampaignStateV1 State { get; }
        public int ProcessedRecoveries { get; }
        public int ScrapStored { get; }
        public int PartsStored { get; }

        public static WorkshopTransactionResult Succeeded(
            CampaignStateV1 state,
            bool changed = true,
            bool idempotentReplay = false,
            int processedRecoveries = 0,
            int scrapStored = 0,
            int partsStored = 0)
        {
            return new WorkshopTransactionResult(
                true,
                changed,
                idempotentReplay,
                null,
                null,
                state,
                processedRecoveries,
                scrapStored,
                partsStored);
        }

        public static WorkshopTransactionResult Failed(
            CampaignStateV1 original,
            string failureCode,
            string message)
        {
            return new WorkshopTransactionResult(
                false,
                false,
                false,
                failureCode,
                message,
                original,
                0,
                0,
                0);
        }
    }

    public sealed class BossRewardV1
    {
        public BossRewardV1(string materialId, string name, string family, string aspect, string tier, int quantity)
        {
            MaterialId = materialId;
            Name = name;
            Family = family;
            Aspect = aspect;
            Tier = tier;
            Quantity = quantity;
        }

        public string MaterialId { get; }
        public string Name { get; }
        public string Family { get; }
        public string Aspect { get; }
        public string Tier { get; }
        public int Quantity { get; }
    }
}
