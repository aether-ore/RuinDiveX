using System;
using System.IO;
using System.Text;
using NUnit.Framework;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;

namespace RuinCrawler.Runtime.Persistence.Tests
{
    public sealed class JsonCampaignEnvelopeStoreTests
    {
        private string root;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(
                Path.GetTempPath(),
                "RuinCrawlerPersistenceTests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
        }

        [TearDown]
        public void TearDown()
        {
            string fullRoot = Path.GetFullPath(root ?? string.Empty);
            string testBase = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "RuinCrawlerPersistenceTests"));
            if (Directory.Exists(fullRoot)
                && fullRoot.StartsWith(testBase + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                Directory.Delete(fullRoot, true);
            }
        }

        [Test]
        public void FreshCommit_SaveReloadAndConflictAreRevisionSafe()
        {
            var store = new JsonCampaignEnvelopeStore(root);
            CampaignStateV1 initial = CampaignStateV1.CreateDefault("save-a");
            initial.salvage.identifiedScrap = 7;
            var create = new CampaignCommitRequest<CampaignStateV1>(
                "create",
                CampaignRevisionToken.NewCampaign("save-a"),
                "write-1",
                "2026-07-17T00:00:00Z",
                initial);

            CampaignCommitResult<CampaignStateV1> committed = store.Commit(create);
            Assert.That(committed.Success, Is.True);
            Assert.That(committed.Envelope.Revision, Is.EqualTo(1));

            CampaignLoadResult<CampaignStateV1> loaded = store.Load("save-a");
            Assert.That(loaded.Status, Is.EqualTo(CampaignLoadStatus.Loaded));
            Assert.That(loaded.Envelope.State.salvage.identifiedScrap, Is.EqualTo(7));

            CampaignStateV1 conflictingState = initial.Clone();
            conflictingState.salvage.identifiedScrap = 99;
            var conflict = new CampaignCommitRequest<CampaignStateV1>(
                "stale-write",
                CampaignRevisionToken.NewCampaign("save-a"),
                "write-2",
                "2026-07-17T00:00:01Z",
                conflictingState);
            CampaignCommitResult<CampaignStateV1> rejected = store.Commit(conflict);
            Assert.That(rejected.Success, Is.False);
            Assert.That(rejected.Failure, Is.EqualTo(CampaignCommitFailure.Conflict));
            Assert.That(store.Load("save-a").Envelope.State.salvage.identifiedScrap, Is.EqualTo(7));
        }

        [Test]
        public void CorruptPrimary_IsQuarantinedAndBackupIsRecovered()
        {
            var store = new JsonCampaignEnvelopeStore(root);
            CampaignStateV1 first = CampaignStateV1.CreateDefault("save-b");
            first.salvage.identifiedScrap = 3;
            CampaignCommitResult<CampaignStateV1> revisionOne = store.Commit(
                new CampaignCommitRequest<CampaignStateV1>(
                    "create",
                    CampaignRevisionToken.NewCampaign("save-b"),
                    "write-1",
                    "2026-07-17T00:00:00Z",
                    first));
            Assert.That(revisionOne.Success, Is.True);

            CampaignStateV1 second = first.Clone();
            second.salvage.identifiedScrap = 9;
            CampaignCommitResult<CampaignStateV1> revisionTwo = store.Commit(
                new CampaignCommitRequest<CampaignStateV1>(
                    "update",
                    revisionOne.Envelope.RevisionToken,
                    "write-2",
                    "2026-07-17T00:00:01Z",
                    second));
            Assert.That(revisionTwo.Success, Is.True);

            string primaryPath = Path.Combine(root, "save-b.json");
            File.WriteAllText(primaryPath, "{ definitely-not-json");

            CampaignLoadResult<CampaignStateV1> recovered = store.Load("save-b");
            Assert.That(recovered.Status, Is.EqualTo(CampaignLoadStatus.RecoveredBackup));
            Assert.That(recovered.Envelope.Revision, Is.EqualTo(1));
            Assert.That(recovered.Envelope.State.salvage.identifiedScrap, Is.EqualTo(3));
            Assert.That(Directory.GetFiles(Path.Combine(root, "Corrupt"), "*.corrupt.json"), Has.Length.EqualTo(1));
            Assert.That(File.Exists(primaryPath), Is.True, "The valid backup should be restored as primary.");
        }

        [Test]
        public void VersionOnePayload_IsLoadedThroughRepairAndNextCommitPersistsVersionTwo()
        {
            const string SaveId = "legacy-save";
            string primaryPath = Path.Combine(root, SaveId + ".json");
            File.WriteAllText(
                primaryPath,
                CreateRawEnvelopeJson(SaveId, 1),
                new UTF8Encoding(false));

            var store = new JsonCampaignEnvelopeStore(root);
            CampaignLoadResult<CampaignStateV1> migrated = store.Load(SaveId);

            Assert.That(migrated.Status, Is.EqualTo(CampaignLoadStatus.Loaded));
            Assert.That(migrated.Warning, Does.Contain("envelope was migrated from version 1 to version 2"));
            Assert.That(migrated.Warning, Does.Contain("migrated from version 1 to version 2"));
            Assert.That(migrated.Envelope.Revision, Is.EqualTo(7));
            Assert.That(migrated.Envelope.State.stateVersion,
                Is.EqualTo(CampaignStateV1.CurrentStateVersion));
            Assert.That(migrated.Envelope.State.expedition.dungeonRulesetVersion, Is.Null,
                "The serialization repair layer must not pin an obsolete dungeon ruleset.");
            Assert.That(migrated.Envelope.State.expedition.ruinId, Is.EqualTo("source-expedition"));
            Assert.That(migrated.Envelope.State.expedition.dungeonProgress.claimedRewardIds,
                Is.EqualTo(new[]
                {
                    DungeonRewardTransactionService.CreateClaimKey(
                        "source-expedition",
                        "source-cache")
                }));
            Assert.That(migrated.Envelope.State.appliedMigrationIds,
                Does.Contain(CampaignStateRepair.DungeonPersistenceV2MigrationId));
            Assert.That(migrated.Envelope.State.appliedMigrationIds,
                Does.Contain(CampaignStateRepair.DungeonRewardClaimsV2MigrationId));

            CampaignCommitResult<CampaignStateV1> committed = store.Commit(
                new CampaignCommitRequest<CampaignStateV1>(
                    "rewrite-v2",
                    migrated.Envelope.RevisionToken,
                    "write-v2",
                    "2026-07-17T00:00:01Z",
                    migrated.Envelope.State));

            Assert.That(committed.Success, Is.True);
            Assert.That(committed.Envelope.Revision, Is.EqualTo(8));
            Assert.That(File.ReadAllText(primaryPath), Does.Contain("\"schemaVersion\": 2"));
            Assert.That(File.ReadAllText(primaryPath), Does.Contain("\"stateVersion\": 2"));
            CampaignLoadResult<CampaignStateV1> reloaded = store.Load(SaveId);
            Assert.That(reloaded.Status, Is.EqualTo(CampaignLoadStatus.Loaded));
            Assert.That(reloaded.Warning, Is.Null);
            Assert.That(reloaded.Envelope.State.appliedMigrationIds.FindAll(value =>
                value == CampaignStateRepair.DungeonRewardClaimsV2MigrationId),
                Has.Count.EqualTo(1));
        }

        [Test]
        public void LegacyEnvelopeWithCurrentPayload_MigratesOnceAndRewritesSchemaTwo()
        {
            const string SaveId = "legacy-envelope-current-payload";
            string primaryPath = Path.Combine(root, SaveId + ".json");
            File.WriteAllText(
                primaryPath,
                CreateRawEnvelopeJson(SaveId, CampaignStateV1.CurrentStateVersion, envelopeVersion: 1),
                new UTF8Encoding(false));

            var store = new JsonCampaignEnvelopeStore(root);
            CampaignLoadResult<CampaignStateV1> migrated = store.Load(SaveId);

            Assert.That(migrated.Status, Is.EqualTo(CampaignLoadStatus.Loaded));
            Assert.That(migrated.Warning,
                Does.Contain("Campaign envelope was migrated from version 1 to version 2."));
            Assert.That(migrated.Envelope.SchemaVersion,
                Is.EqualTo(CampaignEnvelopeV1<CampaignStateV1>.CurrentSchemaVersion));

            CampaignCommitResult<CampaignStateV1> rewritten = store.Commit(
                new CampaignCommitRequest<CampaignStateV1>(
                    "rewrite-envelope-v2",
                    migrated.Envelope.RevisionToken,
                    "write-envelope-v2",
                    "2026-07-17T00:00:01Z",
                    migrated.Envelope.State));

            Assert.That(rewritten.Success, Is.True);
            Assert.That(File.ReadAllText(primaryPath), Does.Contain("\"schemaVersion\": 2"));
            CampaignLoadResult<CampaignStateV1> reloaded = store.Load(SaveId);
            Assert.That(reloaded.Status, Is.EqualTo(CampaignLoadStatus.Loaded));
            Assert.That(reloaded.Warning, Is.Null);
        }

        [TestCase(0)]
        [TestCase(3)]
        public void InvalidOrFutureEnvelopeVersion_RemainsUnsupported(int envelopeVersion)
        {
            string saveId = "unsupported-envelope-" + envelopeVersion;
            File.WriteAllText(
                Path.Combine(root, saveId + ".json"),
                CreateRawEnvelopeJson(
                    saveId,
                    CampaignStateV1.CurrentStateVersion,
                    envelopeVersion),
                new UTF8Encoding(false));

            CampaignLoadResult<CampaignStateV1> loaded =
                new JsonCampaignEnvelopeStore(root).Load(saveId);

            Assert.That(loaded.Status, Is.EqualTo(CampaignLoadStatus.UnsupportedSchema));
            Assert.That(loaded.HasState, Is.False);
            Assert.That(loaded.Warning, Does.Contain("Unsupported or missing campaign envelope schema"));
        }

        [TestCase(0)]
        [TestCase(3)]
        public void InvalidOrFutureStateVersion_RemainsUnsupported(int stateVersion)
        {
            string saveId = "unsupported-" + stateVersion;
            File.WriteAllText(
                Path.Combine(root, saveId + ".json"),
                CreateRawEnvelopeJson(saveId, stateVersion),
                new UTF8Encoding(false));

            CampaignLoadResult<CampaignStateV1> loaded =
                new JsonCampaignEnvelopeStore(root).Load(saveId);

            Assert.That(loaded.Status, Is.EqualTo(CampaignLoadStatus.UnsupportedSchema));
            Assert.That(loaded.HasState, Is.False);
            Assert.That(loaded.Warning, Does.Contain("Unsupported Unity campaign state schema"));
        }

        private static string CreateRawEnvelopeJson(
            string saveId,
            int stateVersion,
            int envelopeVersion = 1)
        {
            return "{\n"
                + "  \"schemaVersion\": " + envelopeVersion + ",\n"
                + "  \"saveContextId\": \"" + saveId + "\",\n"
                + "  \"revision\": 7,\n"
                + "  \"writeId\": \"legacy-write\",\n"
                + "  \"updatedAtUtc\": \"2026-07-17T00:00:00Z\",\n"
                + "  \"state\": {\n"
                + "    \"stateVersion\": " + stateVersion + ",\n"
                + "    \"campaignId\": \"legacy-campaign\",\n"
                + "    \"expedition\": {\n"
                + "      \"runSeed\": \"source-seed\",\n"
                + "      \"expeditionId\": \"source-expedition\",\n"
                + "      \"dungeonProfileId\": \"removed-profile\",\n"
                + "      \"dungeonProgress\": {\n"
                + "        \"claimedRewardIds\": [\"source-cache\"]\n"
                + "      }\n"
                + "    },\n"
                + "    \"appliedMigrationIds\": []\n"
                + "  }\n"
                + "}";
        }
    }
}
