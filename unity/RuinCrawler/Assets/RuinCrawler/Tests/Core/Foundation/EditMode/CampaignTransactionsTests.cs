using System;
using NUnit.Framework;

namespace RuinCrawler.Core.Foundation.Tests
{
    public sealed class CampaignTransactionsTests
    {
        [Test]
        public void FirstCommitCreatesSchemaOneRevisionOneEnvelope()
        {
            CampaignRevisionToken expected = CampaignRevisionToken.NewCampaign("campaign:test-1");
            var request = new CampaignCommitRequest<StubState>(
                "create-campaign",
                expected,
                "write-1",
                "2026-07-17T12:00:00Z",
                new StubState(10));

            CampaignCommitResult<StubState> result = CampaignTransactions.PrepareCommit<StubState>(null, request);

            Assert.That(result.Success, Is.True);
            Assert.That(result.Envelope.SchemaVersion, Is.EqualTo(2));
            Assert.That(result.Envelope.Revision, Is.EqualTo(1));
            Assert.That(result.Envelope.WriteId, Is.EqualTo("write-1"));
            Assert.That(result.Envelope.State.Scrap, Is.EqualTo(10));
        }

        [Test]
        public void MatchingRevisionAdvancesAtomically()
        {
            var current = new CampaignEnvelopeV1<StubState>(
                "campaign:test-1",
                4,
                "write-4",
                "2026-07-17T12:00:00Z",
                new StubState(10));
            var request = new CampaignCommitRequest<StubState>(
                "identify-all",
                current.RevisionToken,
                "write-5",
                "2026-07-17T12:01:00Z",
                new StubState(0));

            CampaignCommitResult<StubState> result = CampaignTransactions.PrepareCommit(current, request);

            Assert.That(result.Success, Is.True);
            Assert.That(result.Envelope.Revision, Is.EqualTo(5));
            Assert.That(result.Envelope.WriteId, Is.EqualTo("write-5"));
            Assert.That(result.Envelope.State.Scrap, Is.Zero);
        }

        [Test]
        public void StaleRevisionIsRejectedWithoutReturningCandidateState()
        {
            var current = new CampaignEnvelopeV1<StubState>(
                "campaign:test-1",
                4,
                "write-4",
                "2026-07-17T12:00:00Z",
                new StubState(10));
            var stale = new CampaignRevisionToken("campaign:test-1", 3, "write-3");
            var request = new CampaignCommitRequest<StubState>(
                "identify-all",
                stale,
                "write-5",
                "2026-07-17T12:01:00Z",
                new StubState(0));

            CampaignCommitResult<StubState> result = CampaignTransactions.PrepareCommit(current, request);

            Assert.That(result.Success, Is.False);
            Assert.That(result.Failure, Is.EqualTo(CampaignCommitFailure.Conflict));
            Assert.That(result.Envelope, Is.Null);
            Assert.That(result.CurrentRevision, Is.EqualTo(current.RevisionToken));
        }

        [Test]
        public void ReusingWriteIdIsRejected()
        {
            var current = new CampaignEnvelopeV1<StubState>(
                "campaign:test-1",
                1,
                "write-1",
                "2026-07-17T12:00:00Z",
                new StubState(10));
            var request = new CampaignCommitRequest<StubState>(
                "bad-write",
                current.RevisionToken,
                "write-1",
                "2026-07-17T12:01:00Z",
                new StubState(9));

            CampaignCommitResult<StubState> result = CampaignTransactions.PrepareCommit(current, request);

            Assert.That(result.Success, Is.False);
            Assert.That(result.Failure, Is.EqualTo(CampaignCommitFailure.InvalidState));
        }

        [Test]
        public void InvalidContextAndNullStateFailVisibly()
        {
            Assert.Throws<ArgumentException>(() => CampaignRevisionToken.NewCampaign("bad context"));
            Assert.Throws<ArgumentNullException>(() =>
                new CampaignCommitRequest<StubState>(
                    "save",
                    CampaignRevisionToken.NewCampaign("campaign:test"),
                    "write-1",
                    "2026-07-17T12:00:00Z",
                    null));
        }

        private sealed class StubState
        {
            public int Scrap { get; }

            public StubState(int scrap)
            {
                Scrap = scrap;
            }
        }
    }
}
