using System;
using System.IO;
using System.Text;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Core.Foundation;
using UnityEngine;

namespace RuinCrawler.Runtime.Persistence
{
    /// <summary>
    /// Unity-only schema-1 envelope adapter. The payload is repaired through
    /// supported campaign state revisions before it reaches runtime services.
    /// Primary writes use a flushed temporary file plus atomic replacement,
    /// retaining the previous primary as backup. Browser saves are intentionally
    /// outside this format and path.
    /// </summary>
    public sealed class JsonCampaignEnvelopeStore : ICampaignEnvelopeStore<CampaignStateV1>
    {
        private readonly object _sync = new object();
        private readonly string _rootDirectory;

        public JsonCampaignEnvelopeStore(string rootDirectory = null)
        {
            _rootDirectory = string.IsNullOrWhiteSpace(rootDirectory)
                ? Path.Combine(Application.persistentDataPath, "RuinCrawler", "Saves")
                : Path.GetFullPath(rootDirectory);
        }

        public string RootDirectory => _rootDirectory;

        public CampaignLoadResult<CampaignStateV1> Load(string saveContextId)
        {
            lock (_sync)
            {
                return LoadUnsafe(saveContextId, restoreBackup: true);
            }
        }

        public CampaignCommitResult<CampaignStateV1> Commit(CampaignCommitRequest<CampaignStateV1> request)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            lock (_sync)
            {
                CampaignLoadResult<CampaignStateV1> load = LoadUnsafe(
                    request.ExpectedRevision.SaveContextId,
                    restoreBackup: true);
                if (load.Status == CampaignLoadStatus.UnsupportedSchema)
                {
                    return CampaignCommitResult<CampaignStateV1>.Failed(
                        CampaignCommitFailure.UnsupportedSchema,
                        load.Envelope?.RevisionToken,
                        load.Warning);
                }

                if (load.Status == CampaignLoadStatus.Corrupt || load.Status == CampaignLoadStatus.Failure)
                {
                    return CampaignCommitResult<CampaignStateV1>.Failed(
                        CampaignCommitFailure.PersistenceFailure,
                        load.Envelope?.RevisionToken,
                        load.Warning ?? "The campaign could not be read safely.");
                }

                CampaignEnvelopeV1<CampaignStateV1> current = load.HasState ? load.Envelope : null;
                CampaignCommitResult<CampaignStateV1> prepared = CampaignTransactions.PrepareCommit(current, request);
                if (!prepared.Success)
                {
                    return prepared;
                }

                string primaryPath = GetPrimaryPath(request.ExpectedRevision.SaveContextId);
                string temporaryPath = primaryPath + ".tmp";
                string backupPath = primaryPath + ".bak";
                try
                {
                    Directory.CreateDirectory(_rootDirectory);
                    EnvelopeDto dto = EnvelopeDto.From(prepared.Envelope);
                    string json = JsonUtility.ToJson(dto, true);
                    WriteFlushed(temporaryPath, json);

                    if (File.Exists(primaryPath))
                    {
                        File.Replace(temporaryPath, primaryPath, backupPath, true);
                    }
                    else
                    {
                        File.Move(temporaryPath, primaryPath);
                    }

                    return prepared;
                }
                catch (Exception exception) when (IsPersistenceException(exception))
                {
                    TryDeleteTemporary(temporaryPath);
                    return CampaignCommitResult<CampaignStateV1>.Failed(
                        CampaignCommitFailure.PersistenceFailure,
                        current?.RevisionToken,
                        "Atomic save failed: " + exception.Message);
                }
            }
        }

        private CampaignLoadResult<CampaignStateV1> LoadUnsafe(string saveContextId, bool restoreBackup)
        {
            string primaryPath = GetPrimaryPath(saveContextId);
            string backupPath = primaryPath + ".bak";
            if (!File.Exists(primaryPath))
            {
                if (!File.Exists(backupPath))
                {
                    return new CampaignLoadResult<CampaignStateV1>(CampaignLoadStatus.NotFound);
                }

                CampaignLoadResult<CampaignStateV1> backupOnly = ReadEnvelope(backupPath, saveContextId);
                if (backupOnly.HasState)
                {
                    if (restoreBackup)
                    {
                        RestoreBackup(backupPath, primaryPath);
                    }

                    return new CampaignLoadResult<CampaignStateV1>(
                        CampaignLoadStatus.RecoveredBackup,
                        backupOnly.Envelope,
                        AppendWarning(
                            "Primary save was missing; recovered the last durable backup.",
                            backupOnly.Warning));
                }

                return backupOnly;
            }

            CampaignLoadResult<CampaignStateV1> primary = ReadEnvelope(primaryPath, saveContextId);
            if (primary.HasState || primary.Status == CampaignLoadStatus.UnsupportedSchema)
            {
                return primary;
            }

            string quarantineWarning = QuarantineCorrupt(primaryPath);
            if (File.Exists(backupPath))
            {
                CampaignLoadResult<CampaignStateV1> backup = ReadEnvelope(backupPath, saveContextId);
                if (backup.HasState)
                {
                    if (restoreBackup)
                    {
                        RestoreBackup(backupPath, primaryPath);
                    }

                    return new CampaignLoadResult<CampaignStateV1>(
                        CampaignLoadStatus.RecoveredBackup,
                        backup.Envelope,
                        AppendWarning(
                            "Primary save was corrupt and quarantined. " + quarantineWarning,
                            backup.Warning));
                }
            }

            return new CampaignLoadResult<CampaignStateV1>(
                CampaignLoadStatus.Corrupt,
                warning: "Primary save was corrupt and no valid backup was available. " + quarantineWarning);
        }

        private static CampaignLoadResult<CampaignStateV1> ReadEnvelope(string path, string expectedContextId)
        {
            try
            {
                string json = File.ReadAllText(path, Encoding.UTF8);
                EnvelopeDto dto = JsonUtility.FromJson<EnvelopeDto>(json);
                if (dto == null || dto.schemaVersion < 1
                    || dto.schemaVersion > CampaignEnvelopeV1<CampaignStateV1>.CurrentSchemaVersion)
                {
                    return new CampaignLoadResult<CampaignStateV1>(
                        CampaignLoadStatus.UnsupportedSchema,
                        warning: "Unsupported or missing campaign envelope schema.");
                }

                if (!string.Equals(dto.saveContextId, expectedContextId, StringComparison.Ordinal))
                {
                    return new CampaignLoadResult<CampaignStateV1>(
                        CampaignLoadStatus.Corrupt,
                        warning: "Save context does not match its file name.");
                }

                if (dto.state == null
                    || dto.state.stateVersion < 1
                    || dto.state.stateVersion > CampaignStateV1.CurrentStateVersion)
                {
                    return new CampaignLoadResult<CampaignStateV1>(
                        CampaignLoadStatus.UnsupportedSchema,
                        warning: "Unsupported Unity campaign state schema.");
                }

                int sourceEnvelopeVersion = dto.schemaVersion;
                int sourceStateVersion = dto.state.stateVersion;
                CampaignStateV1 repaired = CampaignStateRepair.Repair(dto.state);
                var envelope = new CampaignEnvelopeV1<CampaignStateV1>(
                    dto.saveContextId,
                    dto.revision,
                    dto.writeId,
                    dto.updatedAtUtc,
                    repaired);
                string warning = sourceEnvelopeVersion
                        < CampaignEnvelopeV1<CampaignStateV1>.CurrentSchemaVersion
                    ? "Campaign envelope was migrated from version " + sourceEnvelopeVersion
                        + " to version "
                        + CampaignEnvelopeV1<CampaignStateV1>.CurrentSchemaVersion + "."
                    : null;
                warning = AppendWarning(
                    warning,
                    sourceStateVersion < CampaignStateV1.CurrentStateVersion
                    ? "Campaign state was migrated from version " + sourceStateVersion
                        + " to version " + CampaignStateV1.CurrentStateVersion + "."
                    : null);
                return new CampaignLoadResult<CampaignStateV1>(
                    CampaignLoadStatus.Loaded,
                    envelope,
                    warning);
            }
            catch (Exception exception) when (IsPersistenceException(exception)
                                               || exception is ArgumentException
                                               || exception is InvalidOperationException)
            {
                return new CampaignLoadResult<CampaignStateV1>(
                    CampaignLoadStatus.Corrupt,
                    warning: exception.Message);
            }
        }

        private string GetPrimaryPath(string saveContextId)
        {
            if (string.IsNullOrWhiteSpace(saveContextId))
            {
                throw new ArgumentException("A save context id is required.", nameof(saveContextId));
            }

            var builder = new StringBuilder();
            string trimmed = saveContextId.Trim();
            for (int index = 0; index < trimmed.Length; index += 1)
            {
                char value = trimmed[index];
                if (char.IsLetterOrDigit(value) || value == '-' || value == '_' || value == '.')
                {
                    builder.Append(value);
                }
                else
                {
                    builder.Append('_');
                }
            }

            if (builder.Length == 0)
            {
                throw new ArgumentException("Save context id has no usable characters.", nameof(saveContextId));
            }

            return Path.Combine(_rootDirectory, builder + ".json");
        }

        private static void WriteFlushed(string path, string content)
        {
            using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.Write(content);
                writer.Flush();
                stream.Flush(true);
            }
        }

        private static void RestoreBackup(string backupPath, string primaryPath)
        {
            string restorePath = primaryPath + ".restore.tmp";
            File.Copy(backupPath, restorePath, true);
            if (File.Exists(primaryPath))
            {
                File.Replace(restorePath, primaryPath, null, true);
            }
            else
            {
                File.Move(restorePath, primaryPath);
            }
        }

        private string QuarantineCorrupt(string primaryPath)
        {
            try
            {
                string quarantineDirectory = Path.Combine(_rootDirectory, "Corrupt");
                Directory.CreateDirectory(quarantineDirectory);
                string fileName = Path.GetFileNameWithoutExtension(primaryPath)
                    + "." + DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ")
                    + "." + Guid.NewGuid().ToString("N") + ".corrupt.json";
                string destination = Path.Combine(quarantineDirectory, fileName);
                File.Move(primaryPath, destination);
                return "Quarantine: " + destination;
            }
            catch (Exception exception) when (IsPersistenceException(exception))
            {
                return "Quarantine failed: " + exception.Message;
            }
        }

        private static void TryDeleteTemporary(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch (Exception exception) when (IsPersistenceException(exception))
            {
                Debug.LogWarning("Could not clean temporary campaign save: " + exception.Message);
            }
        }

        private static string AppendWarning(string primary, string secondary)
        {
            return string.IsNullOrWhiteSpace(secondary)
                ? primary
                : primary + " " + secondary.Trim();
        }

        private static bool IsPersistenceException(Exception exception)
        {
            return exception is IOException
                || exception is UnauthorizedAccessException
                || exception is NotSupportedException;
        }

        [Serializable]
        private sealed class EnvelopeDto
        {
            public int schemaVersion;
            public string saveContextId;
            public long revision;
            public string writeId;
            public string updatedAtUtc;
            public CampaignStateV1 state;

            public static EnvelopeDto From(CampaignEnvelopeV1<CampaignStateV1> envelope)
            {
                return new EnvelopeDto
                {
                    schemaVersion = CampaignEnvelopeV1<CampaignStateV1>.CurrentSchemaVersion,
                    saveContextId = envelope.SaveContextId,
                    revision = envelope.Revision,
                    writeId = envelope.WriteId,
                    updatedAtUtc = envelope.UpdatedAtUtc,
                    state = CampaignStateRepair.Repair(envelope.State.Clone())
                };
            }
        }
    }
}
