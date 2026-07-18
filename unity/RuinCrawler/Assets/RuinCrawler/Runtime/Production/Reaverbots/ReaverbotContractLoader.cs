using System;
using RuinCrawler.Core.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots
{
    /// <summary>
    /// Unity boundary for the immutable schema-3 Reaverbot catalog. JsonUtility
    /// only projects the two required array-based sections; unrelated contract
    /// sections remain ignored and Core performs all structural validation.
    /// </summary>
    public static class ReaverbotContractLoader
    {
        public const int SupportedContractPackVersion = 1;

        public static ReaverbotCatalog Load(TextAsset contractPack)
        {
            if (contractPack == null)
            {
                throw new ArgumentNullException(nameof(contractPack));
            }

            return LoadJson(contractPack.text);
        }

        public static ReaverbotCatalog LoadJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("Reaverbot contract JSON is empty.", nameof(json));
            }

            RuinCrawlerContractPackDto pack = JsonUtility.FromJson<RuinCrawlerContractPackDto>(json);
            if (pack == null || pack.contractVersion != SupportedContractPackVersion)
            {
                throw new InvalidOperationException("Unsupported Unity contract pack version.");
            }

            if (pack.reaverbots == null || pack.salvage == null)
            {
                throw new InvalidOperationException("Unity contract pack is missing Reaverbot or salvage data.");
            }

            return ReaverbotCatalog.Load(pack);
        }
    }
}
