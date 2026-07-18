using NUnit.Framework;
using RuinCrawler.Core.Dungeon.V2;
using UnityEngine;
using UnityEngine.TestTools;

namespace RuinCrawler.Runtime.Dungeon.Tests
{
    public sealed class DungeonV2AuthoredCutoverTests
    {
        [Test]
        public void BuilderAlwaysUsesAuthoredContentPath()
        {
            var host = new GameObject("DungeonV2AuthoredOnlyHost");
            try
            {
                DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
                Assert.That(builder.AuthoredContentPathActive, Is.True);
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void AuthoredOnlyBuilderFailsClosedWhenRegistryIsMissing()
        {
            DungeonPlanV2 plan = new IndustrialFactoryV2Generator()
                .Generate("authored-cutover-missing-registry");
            var host = new GameObject("DungeonV2CutoverFailClosedHost");
            try
            {
                DungeonSceneBuilderV2 builder = host.AddComponent<DungeonSceneBuilderV2>();
                builder.ConfigureAuthoredModuleRegistry(null, allowResourceFallback: false);

                LogAssert.Expect(
                    LogType.Error,
                    "[RuinCrawler Dungeon V2] V2 authored catalog validation failed: "
                    + "Missing authored module registry Resources/DungeonV2/"
                    + "DungeonAuthoredModuleRegistryV2. Run Bake and Validate Authored Module Library; "
                    + "production generation has no slab fallback.");
                Assert.That(builder.TryBuild(plan, null, null, out string error), Is.False);
                Assert.That(error, Does.Contain("authored catalog validation failed").IgnoreCase);
                Assert.That(builder.GeneratedRoot, Is.Null,
                    "The enabled authored path must never build staging geometry after validation fails.");
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }
    }
}
